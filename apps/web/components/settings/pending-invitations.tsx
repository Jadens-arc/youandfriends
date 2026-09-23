'use client';

import { Badge, Button } from '@youandfriends/ui';
import { useActionState } from 'react';

import type { MemberAction } from './member-management-list';

/** One pending invitation, as the management page shows it. */
export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly scopeType: 'folder' | 'project' | 'song';
  readonly scopeId: string;
  readonly role: 'viewer' | 'commenter' | 'editor';
  readonly expiresAt: Date;
}

const SCOPE_LABEL: Record<PendingInvitation['scopeType'], string> = {
  folder: 'folder',
  project: 'project',
  song: 'song',
};

/**
 * Invitations sent but not yet accepted, with a way to withdraw one (task `032`).
 *
 * Owner-gated the same as the member list it sits beside — `pendingInvitations`
 * (`lib/invitations/service.ts`) already refuses anyone else before this ever renders.
 */
export function PendingInvitations({
  invitations,
  revokeAction,
}: {
  invitations: readonly PendingInvitation[];
  revokeAction: MemberAction;
}) {
  if (invitations.length === 0) {
    return <p className="text-body text-muted-foreground font-sans">No invitations are pending.</p>;
  }

  return (
    <ul className="border-border divide-border bg-card divide-y rounded-md border">
      {invitations.map((invitation) => (
        <InvitationRow key={invitation.id} invitation={invitation} revokeAction={revokeAction} />
      ))}
    </ul>
  );
}

function InvitationRow({
  invitation,
  revokeAction,
}: {
  invitation: PendingInvitation;
  revokeAction: MemberAction;
}) {
  const [state, formAction, pending] = useActionState(revokeAction, { status: 'idle' });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body text-foreground truncate font-sans">{invitation.email}</p>
          <p className="text-caption text-muted-foreground truncate font-sans">
            {SCOPE_LABEL[invitation.scopeType]} {invitation.scopeId} ·{' '}
            <Badge variant="neutral">{invitation.role}</Badge>
          </p>
        </div>
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        </form>
      </div>
      {state.status === 'error' ? (
        <p role="status" aria-live="polite" className="text-caption text-destructive font-sans">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
