import { AppError, invitableRoleSchema } from '@youandfriends/contracts';
import { notFound } from 'next/navigation';

import { InviteForm } from '@/components/settings/invite-form';
import { MemberManagementList } from '@/components/settings/member-management-list';
import {
  PendingInvitations,
  type PendingInvitation,
} from '@/components/settings/pending-invitations';
import { invitationContext } from '@/lib/invitations/context';
import { pendingInvitations } from '@/lib/invitations/service';
import { currentWorkspace, workspaceRequest } from '@/lib/workspace/current';
import { readMemberManagement } from '@/lib/workspace/settings';

import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInvitationAction,
  sendInvitationAction,
} from './actions';

export const metadata = { title: 'Members · You & Friends' };

/**
 * Member management — owners only.
 *
 * Inviting, revoking, changing role, and removing all reach the same owner-only gate before
 * any of this renders: `readMemberManagement` and `pendingInvitations` both call
 * `requireInWorkspace(..., 'manage_members')`, which records the refusal and throws `forbidden`
 * — 404-shaped, so anyone else sees the same "not found" as a route that does not exist.
 */
export default async function MembersPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();

  const request = workspaceRequest(context);
  const [members, invitations] = await Promise.all([
    readMemberManagement(request).catch(handleRefusal),
    pendingInvitations(invitationContext(context)).catch(handleRefusal),
  ]);

  const invites: PendingInvitation[] = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    scopeType: invitation.scopeType,
    scopeId: invitation.scopeId,
    role: invitableRoleSchema.parse(invitation.role),
    expiresAt: invitation.expiresAt,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Members</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">
          Invite a collaborator to exactly the folder, project, or song intended.
        </p>
      </header>

      <section aria-labelledby="members-invite" className="flex flex-col gap-3">
        <h2 id="members-invite" className="text-heading text-foreground font-serif">
          Invite someone
        </h2>
        <InviteForm action={sendInvitationAction} />
      </section>

      <section aria-labelledby="members-pending" className="flex flex-col gap-3">
        <h2 id="members-pending" className="text-heading text-foreground font-serif">
          Pending invitations
        </h2>
        <PendingInvitations invitations={invites} revokeAction={revokeInvitationAction} />
      </section>

      <section aria-labelledby="members-list" className="flex flex-col gap-3">
        <h2 id="members-list" className="text-heading text-foreground font-serif">
          Members
        </h2>
        <MemberManagementList
          members={members}
          currentUserId={context.userId}
          changeRoleAction={changeMemberRoleAction}
          removeAction={removeMemberAction}
        />
      </section>
    </div>
  );
}

function handleRefusal(error: unknown): never {
  if (error instanceof AppError && error.publicCode === 'not_found') notFound();
  throw error;
}
