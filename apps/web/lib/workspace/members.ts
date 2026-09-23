import { withAuditedTransaction, type AuditContext } from '@youandfriends/authz';
import { conflict, newUlid, notFound, type Role } from '@youandfriends/contracts';
import {
  countOwners,
  deleteAllGrantsForMember,
  lockWorkspaceForMembershipWrite,
  membershipRoleOf,
  removeMembership,
  updateMembershipRole,
} from '@youandfriends/db';

import { requireInWorkspace, type WorkspaceRequest } from './settings';

/**
 * Changing a full member's workspace-wide role, and removing someone from a workspace
 * entirely — owner-only, the same gate as the member list and pending invitations sit behind
 * (task `031`).
 *
 * **Not for a scope-limited collaborator.** Someone invited to one song has no workspace-wide
 * role to change; their access is the grant an invitation created
 * (`apps/web/lib/invitations`), and changing that is inviting them again at a different role
 * or removing their grant, not this. `changeMemberRole` refuses rather than silently promoting
 * them to full membership, which is what blindly writing a role onto their (currently null)
 * membership row would do.
 */

export interface MemberManagementContext extends WorkspaceRequest {
  /** Who is making the change, for the "you cannot demote/remove yourself into an ownerless
   *  workspace" guards — distinct from `subject`, which an audit event also needs. */
  readonly actingUserId: string;
}

const idsOf = (context: MemberManagementContext) => context.newId ?? newUlid;

function auditContextOf(context: MemberManagementContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    newId: idsOf(context),
    ...(context.now === undefined ? {} : { now: context.now }),
  };
}

/**
 * Change a full member's workspace-wide role.
 *
 * Refuses to leave a workspace with no owner at all — the one state nothing in the product can
 * recover from through the UI, since owner-level actions are exactly what would be needed to
 * fix it. `lockWorkspaceForMembershipWrite` runs first, inside the transaction, before anything
 * is read: without it, two owners changed concurrently on two different membership rows could
 * each see the other still as `owner` and both proceed, leaving zero (write skew under
 * READ COMMITTED — found in security review). The lock serializes this transaction against any
 * other membership write for the same workspace, so by the time `countOwners` runs, it sees
 * every such write that has already committed.
 */
export async function changeMemberRole(
  context: MemberManagementContext,
  targetUserId: string,
  newRole: Role,
): Promise<void> {
  await requireInWorkspace(context, 'manage_members');

  const currentRole = await membershipRoleOf(context.db, context.workspaceId, targetUserId);
  if (currentRole === null) {
    throw notFound({
      detail: `${targetUserId} has no workspace-wide role to change — they hold a scope grant, not a membership role`,
    });
  }

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await lockWorkspaceForMembershipWrite(tx, context.workspaceId);

    const result = await updateMembershipRole(tx, context.workspaceId, targetUserId, newRole);
    if (result === null) throw notFound();
    if (result.previousRole === newRole) return;

    if (result.previousRole === 'owner' && (await countOwners(tx, context.workspaceId)) === 0) {
      throw conflict({ detail: 'a workspace must keep at least one owner' });
    }

    await audit({
      action: 'member.role_changed',
      targetType: 'member',
      targetId: targetUserId,
      metadata: { from: result.previousRole, to: newRole },
    });
  });
}

/**
 * Remove someone from the workspace: their membership, and every grant they held there.
 *
 * The grants go too, not only the membership row. Leaving them would mean a future re-invite
 * of the same person silently reactivating whatever access they had before, with nothing in
 * the current member list showing it — the opposite of what "removed" should mean.
 *
 * **An owner may remove themselves**, which is how leaving a workspace works — there is no
 * separate "leave" action, and only an owner (the one subject who can pass `manage_members` at
 * all) is ever in a position to call this on their own id. The one thing refused is removing
 * the *last* owner, self or otherwise: the workspace has no other administrator left to fix it.
 * Same write-skew concern as `changeMemberRole`, same fix: `lockWorkspaceForMembershipWrite`
 * runs before the count, so two owners removed concurrently serialize against each other.
 */
export async function removeMember(
  context: MemberManagementContext,
  targetUserId: string,
): Promise<void> {
  await requireInWorkspace(context, 'manage_members');

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await lockWorkspaceForMembershipWrite(tx, context.workspaceId);

    const currentRole = await membershipRoleOf(tx, context.workspaceId, targetUserId);

    if (currentRole === 'owner' && (await countOwners(tx, context.workspaceId)) <= 1) {
      throw conflict({ detail: 'a workspace must keep at least one owner' });
    }

    const grantsRemoved = await deleteAllGrantsForMember(tx, context.workspaceId, targetUserId);
    const removed = await removeMembership(tx, context.workspaceId, targetUserId);
    if (!removed) throw notFound();

    await audit({
      action: 'member.removed',
      targetType: 'member',
      targetId: targetUserId,
      metadata: { previousRole: currentRole, grantsRemoved },
    });
  });
}
