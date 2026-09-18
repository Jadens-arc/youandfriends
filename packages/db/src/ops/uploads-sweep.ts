/**
 * The expired-upload sweep (`docs/OPERATIONS.md` §2).
 *
 * An abandoned multipart upload does not fail — it *waits*. The parts already uploaded sit in
 * the bucket, billed, referenced by nothing, and invisible to every listing the product shows,
 * because the session row that knows their key is expired and nothing reads expired sessions.
 * A browser tab closed halfway through a 2 GB master leaves 1 GB there forever. This is the job
 * that goes and gets them.
 *
 * **Structured like `purge.ts`, deliberately**, for the same reason: planning is a read and
 * costs nothing, executing destroys things, and the two are separable so a run can be inspected
 * before it acts. The aborter is injected rather than imported — `packages/db` may not depend on
 * `packages/storage` (`docs/ARCHITECTURE.md` §3) — and a plan with work in it refuses to execute
 * without one, because marking the rows without aborting the uploads would strand the parts
 * permanently: the next run cannot find what no row points at any more.
 */
import { and, eq, inArray, lt } from 'drizzle-orm';

import { uploadParts, uploadSessions } from '../schema/uploads';
import type { Transaction } from '../transaction';
import type { DirectDatabase } from '../client';

/** Aborts a multipart upload in the store. Supplied by the caller, never imported here. */
export type MultipartAborter = (key: string, uploadId: string) => Promise<void>;

export interface ExpiredSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly objectKey: string;
  /** Null when the session never got as far as opening a multipart upload. */
  readonly uploadId: string | null;
  readonly expiresAt: Date;
}

export interface SweepPlan {
  readonly sessions: readonly ExpiredSession[];
  /** Sessions with a multipart upload to abort. The ones that make an aborter mandatory. */
  readonly abortable: readonly ExpiredSession[];
  readonly now: Date;
}

export interface SweepOptions {
  readonly now?: Date;
  readonly workspaceId?: string;
  /** Bounds a run. The parts are not going anywhere; a job that finishes is worth more. */
  readonly limit?: number;
}

/**
 * Find sessions that have expired without being finished.
 *
 * `state = 'pending'` rather than "not completed": a session already marked `aborted` or
 * `expired` has been through here, and re-aborting it every run would turn one failed abort into
 * a permanent source of noise.
 */
export async function planUploadSweep(
  db: DirectDatabase | Transaction,
  options: SweepOptions = {},
): Promise<SweepPlan> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;

  const rows = await db
    .select({
      id: uploadSessions.id,
      workspaceId: uploadSessions.workspaceId,
      objectKey: uploadSessions.objectKey,
      uploadId: uploadSessions.uploadId,
      expiresAt: uploadSessions.expiresAt,
    })
    .from(uploadSessions)
    .where(
      and(
        eq(uploadSessions.state, 'pending'),
        lt(uploadSessions.expiresAt, now),
        options.workspaceId === undefined
          ? undefined
          : eq(uploadSessions.workspaceId, options.workspaceId),
      ),
    )
    .orderBy(uploadSessions.expiresAt)
    .limit(limit);

  return {
    sessions: rows,
    abortable: rows.filter((row) => row.uploadId !== null),
    now,
  };
}

export interface SweepResult {
  /** Sessions marked expired. */
  readonly swept: number;
  /** Multipart uploads successfully aborted in the store. */
  readonly aborted: number;
  /** Sessions whose abort failed, left `pending` for the next run to retry. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  readonly partRowsDeleted: number;
}

/**
 * Abort the uploads, then mark the rows.
 *
 * **That order is the whole design.** Marking first and aborting second means a failed abort
 * leaves parts in the bucket that no future run will look for — the row no longer says
 * `pending`, so the plan above will never name it again. Aborting first means a failed *update*
 * costs one redundant abort next run, which the store treats as a no-op. One ordering loses
 * money silently and forever; the other repeats a cheap call. There is no third option, and the
 * two are not symmetric.
 *
 * Each session is handled independently: one bucket error must not strand the other 499.
 */
export async function executeUploadSweep(
  db: DirectDatabase,
  plan: SweepPlan,
  abort: MultipartAborter | null,
): Promise<SweepResult> {
  if (plan.abortable.length > 0 && abort === null) {
    throw new Error(
      `sweep plan names ${plan.abortable.length} multipart uploads but no aborter was supplied`,
    );
  }

  // Bound once, so the loop below narrows without an assertion: a plan with nothing to abort
  // legitimately has no aborter, and a plan with something to abort was just rejected above.
  const abortUpload = abort;

  const failed: { id: string; reason: string }[] = [];
  const sweepable: ExpiredSession[] = [];
  let aborted = 0;

  for (const session of plan.sessions) {
    if (session.uploadId === null) {
      // Nothing was ever opened in the store, so there is nothing to strand.
      sweepable.push(session);
      continue;
    }

    if (abortUpload === null) {
      // Unreachable: `uploadId` is non-null, so `abortable` was non-empty and the guard above
      // threw. Present so the narrowing is the type system's rather than a comment's.
      throw new Error(`no aborter for session ${session.id}`);
    }

    try {
      await abortUpload(session.objectKey, session.uploadId);
      aborted += 1;
      sweepable.push(session);
    } catch (error) {
      // Left `pending`, so the next run tries again. A session that keeps failing is a
      // reconciliation problem for a human, and it stays visible until it is one.
      failed.push({
        id: session.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (sweepable.length === 0) {
    return { swept: 0, aborted, failed, partRowsDeleted: 0 };
  }

  const ids = sweepable.map((session) => session.id);

  return db.transaction(async (tx) => {
    const removedParts = await tx
      .delete(uploadParts)
      .where(inArray(uploadParts.sessionId, ids))
      .returning({ id: uploadParts.id });

    const marked = await tx
      .update(uploadSessions)
      .set({ state: 'expired' })
      .where(
        and(
          inArray(uploadSessions.id, ids),
          // Re-checked inside the transaction: a session finalized between the plan and now must
          // not be stamped expired on top of its completion. The plan is a proposal, not a
          // warrant — the same rule purge runs under.
          eq(uploadSessions.state, 'pending'),
        ),
      )
      .returning({ id: uploadSessions.id });

    return {
      swept: marked.length,
      aborted,
      failed,
      partRowsDeleted: removedParts.length,
    };
  });
}

/** A human-readable plan, printed before anything is touched. */
export function describeSweepPlan(plan: SweepPlan): string {
  if (plan.sessions.length === 0) return 'No expired upload sessions.';

  const lines = [
    `${plan.sessions.length} expired upload sessions, ` +
      `${plan.abortable.length} with a multipart upload to abort:`,
  ];
  for (const session of plan.sessions) {
    // The key is named here because this is an operator's console, not a durable record — the
    // audit log is where a key must never land.
    lines.push(
      `  ${session.id}  ${session.objectKey}  expired ${session.expiresAt.toISOString()}` +
        (session.uploadId === null ? '  (never opened)' : ''),
    );
  }
  return lines.join('\n');
}
