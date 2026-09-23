import { asc, eq, sql } from 'drizzle-orm';

import type { Database, DirectDatabase } from '../client';
import { storageObjects, users, workspaceMemberships, workspaces } from '../schema/index';
import type { Transaction } from '../transaction';

/**
 * The workspace itself: provisioning, its members, its name, and how much it stores.
 *
 * **No authorization here**, as everywhere in this package (`docs/ARCHITECTURE.md` §3). These
 * functions answer questions about a workspace id they are handed; whether the caller may ask
 * is decided in `packages/authz` before the id arrives. Every query below filters on that id,
 * so a caller that has been authorized for one workspace cannot read another's usage or
 * members by accident — the tenant is a parameter, never an absence.
 */

/** A workspace this person belongs to, and as what. */
export interface MembershipSummary {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: (typeof workspaceMemberships.$inferSelect)['role'];
}

/**
 * Every workspace a person belongs to, oldest membership first.
 *
 * The order is the default-workspace rule, so it is spelled out rather than left to the
 * planner: the workspace someone joined first is where they land when a request names none.
 * The id breaks ties — two memberships created in one transaction share a timestamp.
 */
export async function membershipsOf(db: Database, userId: string): Promise<MembershipSummary[]> {
  return db
    .select({
      workspaceId: workspaceMemberships.workspaceId,
      workspaceName: workspaces.name,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(asc(workspaceMemberships.createdAt), asc(workspaceMemberships.id));
}

export interface ProvisionWorkspaceInput {
  readonly userId: string;
  readonly name: string;
  /** Used only if this call creates the workspace. */
  readonly workspaceId: string;
  readonly membershipId: string;
}

export interface ProvisionedWorkspace {
  readonly workspaceId: string;
  /** True only for the call that inserted it. Drives the `workspace.created` audit event. */
  readonly created: boolean;
}

/**
 * Give a person with no workspace one of their own, owned by them.
 *
 * Returns `null` when the person already belongs to a workspace — an invited collaborator, or
 * someone whose provisioning already committed. Provisioning is for people with **nowhere to
 * be**; it does not hand every collaborator an empty workspace beside the one they were
 * invited to.
 *
 * **Race-safe by constraint, not by lock.** Concurrent first requests all pass the membership
 * check — none of them can see the others' uncommitted rows. The insert is what serialises
 * them: `workspaces_provisioned_for_user_id_key` makes every insert after the first wait for it
 * and then conflict, and the conflict resolves to the winner's row. One workspace, whichever
 * request wins, and no advisory lock that a connection pooler could silently drop.
 *
 * Takes a transaction because the workspace and its owner's membership are one fact. A
 * workspace nobody belongs to is unreachable by anyone, including the person it was for.
 */
export async function provisionWorkspace(
  tx: Transaction,
  input: ProvisionWorkspaceInput,
): Promise<ProvisionedWorkspace | null> {
  const [existingMembership] = await tx
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(eq(workspaceMemberships.userId, input.userId))
    .limit(1);
  if (existingMembership !== undefined) return null;

  const [inserted] = await tx
    .insert(workspaces)
    .values({
      id: input.workspaceId,
      name: input.name,
      ownerUserId: input.userId,
      provisionedForUserId: input.userId,
    })
    .onConflictDoNothing({ target: workspaces.provisionedForUserId })
    .returning({ id: workspaces.id });

  if (inserted === undefined) {
    // Lost the race: another request provisioned this person and committed while this one
    // waited on the unique index. Its membership committed with it, so there is nothing to add.
    const [winner] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.provisionedForUserId, input.userId));
    if (winner === undefined) {
      // A conflict on a key nobody holds means the row was removed between the two statements.
      // Not a case to paper over with a retry loop here; the caller denies and logs.
      throw new Error(`provisioning conflicted for ${input.userId} but found no workspace`);
    }
    return { workspaceId: winner.id, created: false };
  }

  await tx.insert(workspaceMemberships).values({
    id: input.membershipId,
    workspaceId: inserted.id,
    userId: input.userId,
    role: 'owner',
    // An owner's capabilities are implied by the role; the booleans say so explicitly anyway,
    // so nothing reading the row has to know that rule.
    canDownload: true,
    canInvite: true,
  });

  return { workspaceId: inserted.id, created: true };
}

/** How long a cached storage figure is trusted before a read recomputes it. */
export const STORAGE_USAGE_TTL_MS = 10 * 60 * 1000;

export interface StorageUsage {
  readonly usedBytes: number;
  readonly refreshedAt: Date;
}

/**
 * Recompute a workspace's stored bytes from `storage_objects`, and cache the answer.
 *
 * One statement, so the sum and the write cannot be separated by another writer. Recomputed wholesale rather than
 * incremented: an increment that misses one path — a purge, a sweep, an operator at a `psql`
 * prompt — is wrong forever, where a recomputation is wrong until the next one.
 *
 * Every object counts: originals, derivatives, and anything soft-deleted but not yet purged.
 * That is what the bucket actually holds for this workspace and what it costs; a figure that
 * left out the trash would drop when someone deletes a file, and rise again thirty days later
 * for no reason they could see.
 */
export async function refreshStorageUsage(
  db: DirectDatabase,
  workspaceId: string,
  now: Date,
): Promise<StorageUsage | null> {
  const [row] = await db
    .update(workspaces)
    .set({
      storageUsedBytes: sql`(
        select coalesce(sum(${storageObjects.sizeBytes}), 0)::bigint
        from ${storageObjects}
        where ${storageObjects.workspaceId} = ${workspaceId}
      )`,
      storageUsageRefreshedAt: now,
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({
      usedBytes: workspaces.storageUsedBytes,
      refreshedAt: workspaces.storageUsageRefreshedAt,
    });

  if (row === undefined || row.refreshedAt === null) return null;
  return { usedBytes: row.usedBytes, refreshedAt: row.refreshedAt };
}

/**
 * The workspace's stored bytes, recomputed only when the cached figure is stale.
 *
 * Stale means older than {@link STORAGE_USAGE_TTL_MS}, or explicitly invalidated by
 * {@link markStorageUsageStale}. Most reads are a single-row lookup; one read per TTL pays for
 * the sum. `null` when there is no such workspace.
 */
export async function storageUsage(
  db: DirectDatabase,
  workspaceId: string,
  now: Date,
): Promise<StorageUsage | null> {
  const [cached] = await db
    .select({
      usedBytes: workspaces.storageUsedBytes,
      refreshedAt: workspaces.storageUsageRefreshedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (cached === undefined) return null;

  const { refreshedAt } = cached;
  if (refreshedAt !== null && now.getTime() - refreshedAt.getTime() < STORAGE_USAGE_TTL_MS) {
    return { usedBytes: cached.usedBytes, refreshedAt };
  }

  return refreshStorageUsage(db, workspaceId, now);
}

/**
 * Invalidate the cached figure, so the next read recomputes it.
 *
 * Called in the transaction that adds an object, so an upload shows up the next time someone
 * looks rather than up to a TTL later. Cheaper than recomputing on every write, and correct
 * under concurrent writes where an increment would need the row lock anyway.
 */
export async function markStorageUsageStale(
  db: DirectDatabase | Transaction,
  workspaceId: string,
): Promise<void> {
  await db
    .update(workspaces)
    .set({ storageUsageRefreshedAt: null })
    .where(eq(workspaces.id, workspaceId));
}

/** One person in a workspace, as the settings page shows them. */
export interface WorkspaceMember {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: (typeof workspaceMemberships.$inferSelect)['role'];
  readonly canDownload: boolean;
  readonly canInvite: boolean;
  readonly joinedAt: Date;
}

/** Everyone in one workspace, in the order they joined. */
export async function membersOf(db: Database, workspaceId: string): Promise<WorkspaceMember[]> {
  return db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: workspaceMemberships.role,
      canDownload: workspaceMemberships.canDownload,
      canInvite: workspaceMemberships.canInvite,
      joinedAt: workspaceMemberships.createdAt,
    })
    .from(workspaceMemberships)
    .innerJoin(users, eq(users.id, workspaceMemberships.userId))
    .where(eq(workspaceMemberships.workspaceId, workspaceId))
    .orderBy(asc(workspaceMemberships.createdAt), asc(workspaceMemberships.id));
}

/** A workspace's name, or `null` when there is no such workspace. */
export async function workspaceName(db: Database, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.name ?? null;
}

/**
 * Rename a workspace, returning the name it had before — or `null` if it does not exist.
 *
 * The previous name is read under `FOR UPDATE` so it is the one this write replaced, not one a
 * concurrent rename already overwrote; the audit event records both.
 */
export async function renameWorkspace(
  tx: Transaction,
  workspaceId: string,
  name: string,
): Promise<{ previousName: string } | null> {
  const [current] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  if (current === undefined) return null;

  await tx.update(workspaces).set({ name }).where(eq(workspaces.id, workspaceId));
  return { previousName: current.name };
}
