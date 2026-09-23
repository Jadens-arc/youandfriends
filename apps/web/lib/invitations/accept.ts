import {
  memberSubject,
  parseToken,
  verifySecret,
  withAuditedTransaction,
} from '@youandfriends/authz';
import {
  invitableRoleSchema,
  newUlid,
  type GrantScope,
  type UserId,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  acceptInvitation,
  ensureScopeLimitedMembership,
  findInvitationById,
  upsertGrant,
  users,
  type DirectDatabase,
} from '@youandfriends/db';
import { eq } from 'drizzle-orm';

/**
 * Accepting an invitation from its token.
 *
 * The accepting person is not yet a member of anything this invitation names — that is the
 * whole reason they were sent a token rather than added directly. So this runs on a different
 * authorization surface than everything else in `apps/web/lib/invitations`: there is no
 * workspace to resolve a request against yet, and the token itself is the credential
 * (`docs/THREAT_MODEL.md` T5's share-link pattern, reused for the same reason — nobody has an
 * account relationship to check against before the token is presented).
 *
 * **Every failure looks the same to the caller.** A wrong secret, an expired invitation, a
 * revoked one, and a token that never existed are one message: whether the difference matters
 * is exactly what an attacker probing tokens would use it to learn (task `032`'s acceptance
 * criteria; `docs/THREAT_MODEL.md` T2). The one exception is a *verified, live* invitation
 * bound to a different address than the signed-in person's — they have already proven they
 * hold the token, so naming the mismatch tells them nothing they could not already see by
 * comparing the email in their own inbox to the one they are signed in as.
 */

const GENERIC_REFUSAL = 'This invitation is no longer valid.';

export type AcceptOutcome =
  | {
      readonly kind: 'accepted';
      readonly workspaceId: string;
      readonly scopeType: GrantScope;
      readonly scopeId: string;
    }
  | { readonly kind: 'wrong_email'; readonly invitedEmail: string }
  | { readonly kind: 'refused'; readonly reason: string };

export interface AcceptRequest {
  readonly db: DirectDatabase;
  readonly acceptingUserId: string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
}

export async function acceptInvitationToken(
  request: AcceptRequest,
  token: string,
): Promise<AcceptOutcome> {
  const parsed = parseToken('invite', token);
  if (parsed === null) return { kind: 'refused', reason: GENERIC_REFUSAL };

  const invitation = await findInvitationById(request.db, parsed.id);
  if (invitation === null) return { kind: 'refused', reason: GENERIC_REFUSAL };

  // Checked before state or expiry: a token that fails to verify tells an attacker nothing
  // about whether the invitation is otherwise still live.
  if (!verifySecret(parsed.secret, invitation.tokenHash)) {
    return { kind: 'refused', reason: GENERIC_REFUSAL };
  }

  const now = (request.now ?? (() => new Date()))();
  if (invitation.state !== 'pending' || invitation.expiresAt <= now) {
    return { kind: 'refused', reason: GENERIC_REFUSAL };
  }

  const [accepter] = await request.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, request.acceptingUserId));
  // The session resolved a real `users` row for this id moments ago; its absence here would
  // mean the row vanished between the two, not that this request did anything wrong.
  if (accepter === undefined) return { kind: 'refused', reason: GENERIC_REFUSAL };

  if (accepter.email.trim().toLowerCase() !== invitation.email) {
    return { kind: 'wrong_email', invitedEmail: invitation.email };
  }

  const role = invitableRoleSchema.parse(invitation.role);
  const newId = request.newId ?? newUlid;

  const outcome = await withAuditedTransaction(
    request.db,
    {
      workspaceId: invitation.workspaceId as WorkspaceId,
      actor: memberSubject(request.acceptingUserId as UserId),
      correlationId: request.correlationId,
      newId,
      now: () => now,
    },
    async ({ tx, audit }) => {
      const accepted = await acceptInvitation(tx, invitation.id, request.acceptingUserId, now);
      // Lost a race — someone else finalized this exact invitation (revoked it, or the same
      // token was redeemed twice concurrently) between the read above and this transaction.
      if (accepted === null) return null;

      const membership = await ensureScopeLimitedMembership(
        tx,
        invitation.workspaceId,
        request.acceptingUserId,
        newId(),
      );

      const { grant, created: grantCreated } = await upsertGrant(tx, {
        id: newId(),
        workspaceId: invitation.workspaceId,
        scopeType: invitation.scopeType,
        scopeId: invitation.scopeId,
        subjectKind: 'member',
        subjectId: request.acceptingUserId,
        role,
        canDownload: invitation.canDownload,
        canInvite: invitation.canInvite,
        createdByUserId: invitation.invitedByUserId,
      });

      await audit({
        action: 'invitation.accepted',
        targetType: 'invitation',
        targetId: accepted.id,
        metadata: { scopeType: invitation.scopeType, scopeId: invitation.scopeId },
      });
      if (membership.created) {
        await audit({
          action: 'member.added',
          targetType: 'member',
          targetId: request.acceptingUserId,
          metadata: {
            via: 'invitation',
            role,
            scopeType: invitation.scopeType,
            scopeId: invitation.scopeId,
          },
        });
      }
      await audit({
        action: grantCreated ? 'permission.granted' : 'permission.changed',
        targetType: 'permission_grant',
        targetId: grant.id,
        metadata: { scopeType: grant.scopeType, scopeId: grant.scopeId, role: grant.role },
      });

      return { scopeType: invitation.scopeType, scopeId: invitation.scopeId };
    },
  );

  if (outcome === null) return { kind: 'refused', reason: GENERIC_REFUSAL };
  return { kind: 'accepted', workspaceId: invitation.workspaceId, ...outcome };
}
