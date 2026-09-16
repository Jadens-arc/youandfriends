import { type WorkspaceId } from '@youandfriends/contracts';
import {
  deleteFolder,
  deleteProject,
  deleteSong,
  describePlan,
  executePurge,
  planPurge,
  restoreBatch,
  type CascadeResult,
  type DirectDatabase,
  type ObjectReaper,
  type PurgeOptions,
  type PurgeResult,
} from '@youandfriends/db';

import { withAuditedTransaction, type AuditContext } from './audit';
import { subjectId, type Subject } from './subjects';

/**
 * Delete, restore, and purge — each with its audit event, in its own transaction.
 *
 * The mechanics live in `packages/db`; what lives here is the part that must not be
 * forgettable: every destructive action writes an audit event atomically with itself
 * (ADR 0006). A delete that is not audited is a delete nobody can explain afterwards, and
 * afterwards is the only time anyone looks.
 */

export interface LifecycleContext {
  readonly workspaceId: WorkspaceId;
  readonly actor: Subject;
  readonly correlationId?: string | undefined;
  readonly recoveryWindowDays: number;
  readonly now?: () => Date;
  readonly newId: () => string;
}

function auditContext(context: LifecycleContext): AuditContext {
  const base: AuditContext = {
    workspaceId: context.workspaceId,
    actor: context.actor,
    newId: context.newId,
  };
  return {
    ...base,
    ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    ...(context.now === undefined ? {} : { now: context.now }),
  };
}

type Entity = 'folder' | 'project' | 'song';

const DELETE_ACTION = {
  folder: 'folder.deleted',
  project: 'project.deleted',
  song: 'song.deleted',
} as const;

const RESTORE_ACTION = {
  folder: 'folder.restored',
  project: 'project.restored',
  song: 'song.restored',
} as const;

/**
 * Soft-delete an entity and everything the cascade reaches.
 *
 * One audit event per row touched, not one per operation. Deleting a folder can remove forty
 * songs, and "who deleted this song" must be answerable for each of them — a single
 * folder-level event would leave thirty-nine questions unanswered.
 */
export async function deleteEntity(
  db: DirectDatabase,
  context: LifecycleContext,
  entity: Entity,
  id: string,
): Promise<CascadeResult> {
  const now = context.now ?? (() => new Date());
  const batch = context.newId();

  return withAuditedTransaction(db, auditContext(context), async ({ tx, audit }) => {
    const options = {
      workspaceId: context.workspaceId,
      deletedBy: subjectId(context.actor),
      batch,
      now: now(),
      recoveryWindowDays: context.recoveryWindowDays,
    };

    const result =
      entity === 'folder'
        ? await deleteFolder(tx, id, options)
        : entity === 'project'
          ? await deleteProject(tx, id, options)
          : await deleteSong(tx, id, options);

    await emitFor(audit, result, DELETE_ACTION, { batch });
    return result;
  });
}

/** Restore everything a given delete removed — and audit each row it brought back. */
export async function restoreEntity(
  db: DirectDatabase,
  context: LifecycleContext,
  batch: string,
): Promise<CascadeResult> {
  return withAuditedTransaction(db, auditContext(context), async ({ tx, audit }) => {
    const result = await restoreBatch(tx, batch, context.workspaceId);
    await emitFor(audit, result, RESTORE_ACTION, { batch });
    return result;
  });
}

type ActionMap = typeof DELETE_ACTION | typeof RESTORE_ACTION;

async function emitFor(
  audit: (entry: {
    action: ActionMap[Entity];
    targetType: Entity;
    targetId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>,
  result: CascadeResult,
  actions: ActionMap,
  metadata: Record<string, unknown>,
): Promise<void> {
  const groups: [Entity, readonly string[]][] = [
    ['folder', result.folders],
    ['project', result.projects],
    ['song', result.songs],
  ];

  for (const [entity, ids] of groups) {
    for (const id of ids) {
      await audit({ action: actions[entity], targetType: entity, targetId: id, metadata });
    }
  }
}

export interface PurgeRunOptions extends PurgeOptions {
  /** Produce and return the plan without destroying anything. */
  readonly dryRun: boolean;
  readonly reaper?: ObjectReaper | null | undefined;
}

export interface PurgeRun {
  readonly plan: ReturnType<typeof describePlan>;
  readonly result: PurgeResult | null;
}

/**
 * Run a purge, or plan one.
 *
 * A dry run never opens a write transaction at all — it cannot destroy anything even if the
 * caller's `dryRun` flag were computed wrongly, because the code path that deletes is not
 * reached. That is a stronger guarantee than checking the flag before each delete.
 */
export async function runPurge(
  db: DirectDatabase,
  context: LifecycleContext,
  options: PurgeRunOptions,
): Promise<PurgeRun> {
  const plan = await planPurge(db, options);
  const rendered = describePlan(plan);

  if (options.dryRun) return { plan: rendered, result: null };

  const result = await withAuditedTransaction(db, auditContext(context), async ({ tx, audit }) => {
    const executed = await executePurge(tx, plan, options.reaper ?? null);

    // Purge is audited per row, like delete, and for the same reason — except that here the
    // row itself is gone, so the audit event is the only remaining record that it existed.
    for (const candidate of plan.candidates) {
      await audit({
        action:
          candidate.table === 'folders'
            ? 'folder.deleted'
            : candidate.table === 'projects'
              ? 'project.deleted'
              : 'song.deleted',
        targetType:
          candidate.table === 'folders'
            ? 'folder'
            : candidate.table === 'projects'
              ? 'project'
              : 'song',
        targetId: candidate.id,
        metadata: {
          purged: true,
          deletedAt: candidate.deletedAt.toISOString(),
          purgeAfter: candidate.purgeAfter.toISOString(),
        },
      });
    }

    return executed;
  });

  return { plan: rendered, result };
}
