import { type WorkspaceId } from '@youandfriends/contracts';
import {
  deleteAsset,
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
  type PurgeCandidate,
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

/** What a caller may delete by name. Snapshots are reached by cascade, never asked for. */
type Entity = 'folder' | 'project' | 'song' | 'asset';

/**
 * Every entity a cascade can touch, including the ones no caller names directly.
 *
 * A snapshot is never deleted by name — it goes when its project does — but it still gets its
 * own event. The rule this module exists to keep is one event per row touched, and a snapshot
 * counted inside somebody else's event is a row whose disappearance nobody can explain.
 */
type Touched = Entity | 'snapshot';

const DELETE_ACTION = {
  folder: 'folder.deleted',
  project: 'project.deleted',
  song: 'song.deleted',
  asset: 'asset.deleted',
  snapshot: 'snapshot.deleted',
} as const;

const RESTORE_ACTION = {
  folder: 'folder.restored',
  project: 'project.restored',
  song: 'song.restored',
  asset: 'asset.restored',
  snapshot: 'snapshot.restored',
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
          : entity === 'asset'
            ? await deleteAsset(tx, id, options)
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

/**
 * A purge candidate's table, as the entity its audit event names.
 *
 * A map rather than a chain of ternaries: the chain had a trailing `: 'song.deleted'`, so
 * adding `assets` and `snapshots` to the planner would have filed every purged asset under
 * `song.deleted` — an audit log that is wrong is worse than one that is missing, because it
 * gets believed.
 */
const PURGED_ENTITY = {
  folders: 'folder',
  projects: 'project',
  songs: 'song',
  assets: 'asset',
  snapshots: 'snapshot',
} as const satisfies Record<PurgeCandidate['table'], Touched>;

async function emitFor(
  audit: (entry: {
    action: ActionMap[Touched];
    targetType: Touched;
    targetId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>,
  result: CascadeResult,
  actions: ActionMap,
  metadata: Record<string, unknown>,
): Promise<void> {
  const groups: [Touched, readonly string[]][] = [
    ['folder', result.folders],
    ['project', result.projects],
    ['song', result.songs],
    ['asset', result.assets],
    ['snapshot', result.snapshots],
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
    //
    // Written from what `executePurge` actually destroyed, not from the plan. A row its owner
    // restored between planning and running is correctly not purged, and an event claiming it
    // was would be a lie the log keeps forever.
    const deletedAt = new Map(
      plan.candidates.map((candidate) => [candidate.id, candidate] as const),
    );

    for (const [table, ids] of Object.entries(executed.destroyed) as [
      PurgeCandidate['table'],
      readonly string[],
    ][]) {
      const entity = PURGED_ENTITY[table];
      for (const id of ids) {
        const candidate = deletedAt.get(id);
        await audit({
          action: DELETE_ACTION[entity],
          targetType: entity,
          targetId: id,
          metadata: {
            purged: true,
            ...(candidate === undefined
              ? {}
              : {
                  deletedAt: candidate.deletedAt.toISOString(),
                  purgeAfter: candidate.purgeAfter.toISOString(),
                }),
          },
        });
      }
    }

    return executed;
  });

  return { plan: rendered, result };
}
