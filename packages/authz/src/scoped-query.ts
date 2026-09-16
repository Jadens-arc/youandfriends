import { forbidden, type WorkspaceId } from '@youandfriends/contracts';
import {
  assetVersions,
  assets,
  derivatives,
  excludeDeleted,
  favorites,
  folders,
  hasSoftDelete,
  mixVersions,
  permissionGrants,
  projects,
  snapshotEntries,
  snapshots,
  songs,
  storageObjects,
  workspaceMemberships,
  type Database,
} from '@youandfriends/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { inheritsMembership, type Subject } from './subjects';

/**
 * A database handle that cannot read outside one workspace.
 *
 * Every read goes through here with the tenant filter already applied, so forgetting it is
 * not possible rather than merely discouraged. ADR 0006 calls the ergonomic cost of this
 * "the point": reaching for the raw Drizzle client is meant to feel like stepping around
 * something.
 *
 * It is not a replacement for `assertCan`. This bounds *which tenant's rows* a query can
 * see; `assertCan` decides whether this subject may do a particular thing to a particular
 * one of them. A handler needs both.
 */

/**
 * The tables a scoped handle can read.
 *
 * An explicit union rather than "any table with a `workspace_id` column". A structural
 * constraint would silently accept a table that gains the column later without anyone
 * deciding it should be readable this way; adding a line here is that decision.
 */
export const SCOPED_TABLES = {
  folders,
  projects,
  songs,
  favorites,
  workspaceMemberships,
  permissionGrants,
  assets,
  assetVersions,
  mixVersions,
  derivatives,
  storageObjects,
  snapshots,
  snapshotEntries,
} as const;

export type ScopedTable = (typeof SCOPED_TABLES)[keyof typeof SCOPED_TABLES];

/**
 * Whether a read includes rows in the trash.
 *
 * Excluding them is the default, and deliberately not a flag the caller has to remember: a
 * forgotten filter shows deleted work as though it were live, which is the bug that makes
 * "deleted" meaningless. Asking for `deleted` or `all` is an explicit, visible decision —
 * the trash view, the restore flow, and the purge job are the only callers that need it.
 */
export type Lifecycle = 'live' | 'deleted' | 'all';

export interface ScopedOptions {
  readonly lifecycle?: Lifecycle | undefined;
}

export interface ScopedDb {
  readonly workspaceId: WorkspaceId;
  /** Live rows of `table` in this workspace, optionally narrowed further. */
  many<T extends ScopedTable>(
    table: T,
    where?: SQL,
    options?: ScopedOptions,
  ): Promise<T['$inferSelect'][]>;
  /** The first matching live row, or `null`. */
  one<T extends ScopedTable>(
    table: T,
    where?: SQL,
    options?: ScopedOptions,
  ): Promise<T['$inferSelect'] | null>;
  /** How many live rows match, in this workspace. */
  count(table: ScopedTable, where?: SQL, options?: ScopedOptions): Promise<number>;
}

/**
 * Open a scoped handle, after confirming the subject belongs to the workspace.
 *
 * The membership check is the tenant boundary itself: without it a handle could be opened on
 * any workspace id a caller cared to supply, and the filter would faithfully scope the query
 * to someone else's data. Failure is `forbidden`, which serializes 404-shaped — a 403 here
 * would confirm the workspace exists (`docs/THREAT_MODEL.md` T1).
 */
export async function scopedQuery(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
): Promise<ScopedDb> {
  if (!inheritsMembership(subject)) {
    // A sync token or share-link bearer is authorized against a specific target, never
    // against a workspace. Giving one a workspace-wide handle would make a link to one song
    // a key to everything (THREAT_MODEL T5).
    throw forbidden({ detail: `${subject.kind} cannot open a workspace-scoped handle` });
  }

  const [membership] = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, subject.userId),
      ),
    );

  if (!membership) {
    throw forbidden({ detail: `user ${subject.userId} is not a member of ${workspaceId}` });
  }

  /**
   * The tenant filter, `and`ed with whatever the caller asked for.
   *
   * `and` and not replacement: a caller's condition can only narrow what the tenant filter
   * already allows, never widen past it. The cast is the one place a `ScopedTable` union is
   * flattened for Drizzle's builder, which types `.from()` against a single table.
   */
  const scope = (table: ScopedTable, where?: SQL, options?: ScopedOptions): SQL => {
    const conditions: SQL[] = [eq(table.workspaceId, workspaceId)];

    // Tombstones are excluded unless the caller says otherwise. A table without the columns
    // has no lifecycle to filter on, so asking for one there is silently satisfied rather
    // than an error — `permission_grants` is not deleted, it is revoked.
    const lifecycle = options?.lifecycle ?? 'live';
    if (lifecycle !== 'all' && hasSoftDelete(table)) {
      conditions.push(
        lifecycle === 'live' ? excludeDeleted(table) : (sql`${table.deletedAt} is not null` as SQL),
      );
    }

    if (where !== undefined) conditions.push(where);
    return and(...conditions) as SQL;
  };

  const from = (table: ScopedTable) => db.select().from(table as typeof folders);

  return {
    workspaceId,

    async many(table, where, options) {
      return (await from(table).where(scope(table, where, options))) as never;
    },

    async one(table, where, options) {
      const rows = await from(table)
        .where(scope(table, where, options))
        .limit(1);
      return (rows[0] ?? null) as never;
    },

    async count(table, where, options) {
      const rows = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(table as typeof folders)
        .where(scope(table, where, options));
      return rows[0]?.total ?? 0;
    },
  };
}
