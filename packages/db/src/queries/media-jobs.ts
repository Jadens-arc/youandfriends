import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import type { Transaction } from '../transaction';
import { assets } from '../schema/assets';
import { mediaJobs } from '../schema/media-jobs';
import { storageObjects } from '../schema/storage-objects';
import { assetVersions } from '../schema/versions';

/**
 * The `media_jobs` bookkeeping shared by whoever enqueues (the web tier), whoever runs (the
 * worker in `apps/jobs`), and whoever retries (`ops:media:retry`) — task `064`.
 *
 * No authorization here. The web caller has already authorized the upload the job follows from;
 * the worker and the operator act as the system.
 */

type Db = DirectDatabase | Transaction;

export type MediaJobRow = typeof mediaJobs.$inferSelect;

/** What a dispatcher needs to schedule a version's processing, read from the rows, not a request. */
export interface MediaJobSource {
  readonly workspaceId: string;
  readonly assetVersionId: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  /** Decides which operations apply: audio, artwork, or none (task `069`). */
  readonly assetKind: (typeof assets.$inferSelect)['kind'];
}

export async function loadMediaJobSource(
  db: Db,
  workspaceId: string,
  assetVersionId: string,
): Promise<MediaJobSource | null> {
  const [row] = await db
    .select({
      objectKey: storageObjects.key,
      sizeBytes: storageObjects.sizeBytes,
      assetKind: assets.kind,
    })
    .from(assetVersions)
    .innerJoin(
      assets,
      and(eq(assets.id, assetVersions.assetId), eq(assets.workspaceId, assetVersions.workspaceId)),
    )
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, assetVersions.storageObjectId),
        eq(storageObjects.workspaceId, assetVersions.workspaceId),
      ),
    )
    .where(and(eq(assetVersions.id, assetVersionId), eq(assetVersions.workspaceId, workspaceId)));
  return row === undefined ? null : { workspaceId, assetVersionId, ...row };
}

/**
 * The job row for a version, created `queued` if it does not exist. Idempotent: a second call
 * returns the first row untouched, whatever state it has reached.
 */
export async function ensureMediaJob(
  db: Db,
  input: { readonly id: string; readonly workspaceId: string; readonly assetVersionId: string },
): Promise<MediaJobRow> {
  await db.insert(mediaJobs).values(input).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(mediaJobs)
    .where(
      and(
        eq(mediaJobs.workspaceId, input.workspaceId),
        eq(mediaJobs.assetVersionId, input.assetVersionId),
      ),
    );
  if (row === undefined) throw new Error(`media job for ${input.assetVersionId} vanished`);
  return row;
}

/** The queue accepted the work. The state stays `queued`: accepted is not started. */
export async function recordMediaJobDispatched(
  db: Db,
  workspaceId: string,
  assetVersionId: string,
  runId: string,
): Promise<void> {
  await db
    .update(mediaJobs)
    .set({ runId, lastError: null, updatedAt: sql`now()` })
    .where(
      and(eq(mediaJobs.workspaceId, workspaceId), eq(mediaJobs.assetVersionId, assetVersionId)),
    );
}

/**
 * The queue refused or could not be reached. The row stays `queued` — honestly unprocessed —
 * with the reason, so the version reads "processing" and `ops:media:retry` can find it.
 */
export async function recordMediaJobDispatchFailed(
  db: Db,
  workspaceId: string,
  assetVersionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(mediaJobs)
    .set({ lastError: `not dispatched: ${reason}`.slice(0, 500), updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaJobs.workspaceId, workspaceId),
        eq(mediaJobs.assetVersionId, assetVersionId),
        eq(mediaJobs.state, 'queued'),
      ),
    );
}

export interface RetryCandidateOptions {
  /** `failed` jobs, `queued` ones never picked up, `running` ones whose worker vanished. */
  readonly states: readonly ('queued' | 'failed' | 'running')[];
  readonly workspaceId?: string | undefined;
  readonly assetVersionId?: string | undefined;
  /** Only queued jobs older than this — a job queued a second ago is not stuck. */
  readonly queuedBefore?: Date | undefined;
  /**
   * Only running jobs last touched before this. Required to list `running` at all: a running job
   * is only retryable once it is older than any worker could still be working on it.
   */
  readonly runningBefore?: Date | undefined;
  readonly limit?: number | undefined;
}

/**
 * Jobs an operator may send again. Never `complete`, and never a `running` job young enough that
 * its worker may still be alive.
 */
export async function listRetryableMediaJobs(
  db: Db,
  options: RetryCandidateOptions,
): Promise<MediaJobRow[]> {
  if (options.states.length === 0) return [];
  const conditions = [inArray(mediaJobs.state, [...options.states])];
  if (options.workspaceId !== undefined) {
    conditions.push(eq(mediaJobs.workspaceId, options.workspaceId));
  }
  if (options.assetVersionId !== undefined) {
    conditions.push(eq(mediaJobs.assetVersionId, options.assetVersionId));
  }
  const runningBefore = options.runningBefore;
  conditions.push(
    runningBefore === undefined
      ? sql`${mediaJobs.state} <> 'running'`
      : sql`(${mediaJobs.state} <> 'running' or ${mediaJobs.updatedAt} < ${runningBefore})`,
  );
  if (options.queuedBefore !== undefined) {
    conditions.push(
      sql`(${mediaJobs.state} <> 'queued' or ${mediaJobs.updatedAt} < ${options.queuedBefore})`,
    );
  }
  return db
    .select()
    .from(mediaJobs)
    .where(and(...conditions))
    .orderBy(asc(mediaJobs.createdAt))
    .limit(options.limit ?? 500);
}

/**
 * Put a failed (or abandoned) job back in the queue's hands. Attempts are kept — they are history — and the
 * version returns to `queued` so the interface says processing again rather than failed.
 * Returns false when the job was not failed or queued (someone else got there first).
 */
export async function resetMediaJobForRetry(
  db: Db,
  workspaceId: string,
  assetVersionId: string,
  options: { readonly runningBefore?: Date | undefined } = {},
): Promise<boolean> {
  const runningBefore = options.runningBefore;
  const updated = await db
    .update(mediaJobs)
    .set({ state: 'queued', lastError: null, finishedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaJobs.workspaceId, workspaceId),
        eq(mediaJobs.assetVersionId, assetVersionId),
        runningBefore === undefined
          ? inArray(mediaJobs.state, ['queued', 'failed'])
          : sql`(${mediaJobs.state} in ('queued', 'failed')
                 or (${mediaJobs.state} = 'running' and ${mediaJobs.updatedAt} < ${runningBefore}))`,
      ),
    )
    .returning({ id: mediaJobs.id });
  if (updated.length === 0) return false;
  await db
    .update(assetVersions)
    .set({ processingState: 'queued', processingError: null })
    .where(
      and(
        eq(assetVersions.id, assetVersionId),
        eq(assetVersions.workspaceId, workspaceId),
        inArray(assetVersions.processingState, ['queued', 'failed', 'running']),
      ),
    );
  return true;
}
