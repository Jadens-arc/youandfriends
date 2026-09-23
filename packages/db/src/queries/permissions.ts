import { and, eq, sql } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import { permissionGrants } from '../schema/permissions';
import type { Transaction } from '../transaction';

/**
 * Permission grants: the row `permission_grants` holds for one subject on one scope.
 *
 * **No authorization here**, as everywhere in this package. `packages/authz` decides whether a
 * caller may write one of these; this module only writes what it is told, workspace-scoped
 * throughout so a write cannot reach another tenant's row.
 */

export type GrantRow = typeof permissionGrants.$inferSelect;

export interface UpsertGrantInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly scopeType: 'folder' | 'project' | 'song';
  readonly scopeId: string;
  readonly subjectKind: 'member' | 'sync_token' | 'share_link';
  readonly subjectId: string;
  readonly role: 'viewer' | 'commenter' | 'editor';
  readonly canDownload: boolean;
  readonly canInvite: boolean;
  readonly createdByUserId: string;
}

export interface UpsertGrantResult {
  readonly grant: GrantRow;
  /** True only when this call inserted the row. `false` means an existing grant was updated —
   *  the caller's audit event should say "changed", not "granted". */
  readonly created: boolean;
}

/**
 * Create a grant, or update it if this subject already holds one at this exact scope.
 *
 * A subject can hold at most one grant per scope (`permission_grants_scope_subject_key`), so
 * accepting a second invitation to the same song — an owner re-inviting someone at a different
 * role rather than using the role-change control — must update the existing row rather than
 * collide with it. `createdByUserId` and `createdAt` are left alone on update: they record who
 * first gave this subject access here, not who most recently touched it.
 */
export async function upsertGrant(
  tx: Transaction,
  input: UpsertGrantInput,
): Promise<UpsertGrantResult> {
  const [existing] = await tx
    .select({ id: permissionGrants.id })
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, input.workspaceId),
        eq(permissionGrants.scopeType, input.scopeType),
        eq(permissionGrants.scopeId, input.scopeId),
        eq(permissionGrants.subjectKind, input.subjectKind),
        eq(permissionGrants.subjectId, input.subjectId),
      ),
    );

  if (existing === undefined) {
    const [grant] = await tx
      .insert(permissionGrants)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        role: input.role,
        canDownload: input.canDownload,
        canInvite: input.canInvite,
        isDeny: false,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (grant === undefined) throw new Error('grant insert returned nothing');
    return { grant, created: true };
  }

  const [grant] = await tx
    .update(permissionGrants)
    .set({
      role: input.role,
      canDownload: input.canDownload,
      canInvite: input.canInvite,
      isDeny: false,
    })
    .where(eq(permissionGrants.id, existing.id))
    .returning();
  if (grant === undefined) throw new Error('grant update returned nothing');
  return { grant, created: false };
}

/** One subject's grant at one exact scope, or `null`. */
export async function findGrant(
  db: DirectDatabase,
  workspaceId: string,
  scopeType: 'folder' | 'project' | 'song',
  scopeId: string,
  subjectId: string,
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.scopeType, scopeType),
        eq(permissionGrants.scopeId, scopeId),
        eq(permissionGrants.subjectKind, 'member'),
        eq(permissionGrants.subjectId, subjectId),
      ),
    );
  return row ?? null;
}

/**
 * How many grants each member subject holds in a workspace, for the member list's "scope
 * display" (task `032`): a scope-limited collaborator's row has no workspace-wide role to show,
 * so this is what it shows instead. A count rather than each grant's target's name — resolving
 * a folder, project, or song name means three different tables and a naming convention that
 * differs between them (`title` on songs, `name` elsewhere), and the settings page has no need
 * to be the first place that logic lives. It belongs beside the library browser that can link
 * to what it names, once one exists (task `040` onward).
 */
export async function grantCountsByMember(
  db: DirectDatabase,
  workspaceId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ subjectId: permissionGrants.subjectId, count: sql<number>`count(*)::int` })
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.subjectKind, 'member'),
      ),
    )
    .groupBy(permissionGrants.subjectId);

  return new Map(rows.map((row) => [row.subjectId, row.count]));
}

/** Every grant a member subject holds in a workspace — what removal has to clear. */
export async function grantsForMember(
  db: DirectDatabase,
  workspaceId: string,
  userId: string,
): Promise<GrantRow[]> {
  return db
    .select()
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.subjectKind, 'member'),
        eq(permissionGrants.subjectId, userId),
      ),
    );
}

/** Remove one grant. Returns the row that was removed, or `null` if there was none. */
export async function deleteGrant(
  tx: Transaction,
  workspaceId: string,
  scopeType: 'folder' | 'project' | 'song',
  scopeId: string,
  subjectId: string,
): Promise<GrantRow | null> {
  const [row] = await tx
    .delete(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.scopeType, scopeType),
        eq(permissionGrants.scopeId, scopeId),
        eq(permissionGrants.subjectKind, 'member'),
        eq(permissionGrants.subjectId, subjectId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Remove every grant a member subject holds in a workspace. Returns how many were removed. */
export async function deleteAllGrantsForMember(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const rows = await tx
    .delete(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.subjectKind, 'member'),
        eq(permissionGrants.subjectId, userId),
      ),
    )
    .returning({ id: permissionGrants.id });
  return rows.length;
}
