import {
  buildToken,
  canGrantAccess,
  describeGrantRefusal,
  generateTokenSecret,
  hashSecret,
  inviteRequestSchema,
  withAuditedTransaction,
  type AuditContext,
  type Target,
} from '@youandfriends/authz';
import {
  conflict,
  fieldErrorsFromZod,
  newUlid,
  notFound,
  validationFailed,
} from '@youandfriends/contracts';
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
  findInvitationById,
} from '@youandfriends/db';

import { requireInWorkspace } from '@/lib/workspace/settings';

import type { InvitationContext } from './context';

/**
 * Sending and revoking invitations.
 *
 * **Not email delivery.** No message provider is wired up (that is task `096`); an invitation
 * here produces a link, shown once to whoever sent it, the same way a share link or an upload's
 * presigned URL is shown once and never again (`docs/THREAT_MODEL.md` T3). Displaying a real,
 * working link is the honest thing to build without one; a call to an email API that does not
 * exist would be exactly the fabricated integration CLAUDE.md §7 rules out.
 */

/** How long an invitation stays acceptable. A season, not a lifetime — long enough for someone
 *  travelling to see it, short enough that a link sitting in an old email eventually stops
 *  working on its own. */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const clockOf = (context: InvitationContext) => context.now ?? (() => new Date());
const idsOf = (context: InvitationContext) => context.newId ?? newUlid;

function auditContextOf(context: InvitationContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: clockOf(context),
    newId: idsOf(context),
  };
}

export interface SentInvitation {
  readonly invitationId: string;
  /** The full bearer token. Shown to the caller exactly once — never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Send an invitation, if the caller may offer what they are asking to offer.
 *
 * Three checks, in order, each closing a different door:
 *  1. `assertCan(subject, 'invite', target)` — may this subject invite *here at all*. 404-shaped
 *     if the scope does not resolve in this workspace, so a folder/project/song id from another
 *     tenant is indistinguishable from one that does not exist (`docs/THREAT_MODEL.md` T1).
 *  2. `canGrantAccess` — may this subject offer *this role and these capabilities* here. A
 *     `can_invite` delegate is not thereby handed authority to mint access beyond their own
 *     reach (T2; `packages/authz/src/invitations.ts`).
 *  3. The database's own partial unique index — is there already a live invitation to this
 *     address at this scope. Surfaces as `conflict`, not a second, silently-abandoned offer.
 */
export async function sendInvitation(
  context: InvitationContext,
  raw: unknown,
): Promise<SentInvitation> {
  const parsed = inviteRequestSchema.safeParse(raw);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const request = parsed.data;

  const target: Target = {
    workspaceId: context.workspaceId,
    scopeType: request.scopeType,
    scopeId: request.scopeId,
  };
  await context.authz.assertCan(context.subject, 'invite', target);

  const inviterAccess = await context.authz.resolveAccess(context.subject, target);
  if (!canGrantAccess(inviterAccess, request)) {
    throw validationFailed([
      { path: 'role', message: describeGrantRefusal(inviterAccess, request) },
    ]);
  }

  const newId = idsOf(context);
  const now = clockOf(context)();
  const id = newId();
  const secret = generateTokenSecret();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  const created = await withAuditedTransaction(
    context.db,
    auditContextOf(context),
    async ({ tx, audit }) => {
      const row = await createInvitation(tx, {
        id,
        workspaceId: context.workspaceId,
        email: request.email,
        scopeType: request.scopeType,
        scopeId: request.scopeId,
        role: request.role,
        canDownload: request.canDownload,
        canInvite: request.canInvite,
        tokenHash: hashSecret(secret),
        invitedByUserId: context.userId,
        expiresAt,
      });
      if (row === null) {
        throw conflict({
          detail: `an invitation to ${request.email} at ${request.scopeType} ${request.scopeId} is already pending`,
        });
      }

      await audit({
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: row.id,
        metadata: { scopeType: row.scopeType, scopeId: row.scopeId, role: row.role },
      });
      return row;
    },
  );

  return { invitationId: created.id, token: buildToken('invite', id, secret), expiresAt };
}

/**
 * The pending invitations for the current workspace, for the member-management view.
 *
 * Owner-gated, the same as the member list it sits beside (task `031`) — who is being invited
 * to what is workspace membership and access structure itself (`docs/THREAT_MODEL.md`, asset
 * 3), not something every collaborator should be able to browse.
 */
export async function pendingInvitations(context: InvitationContext) {
  await requireInWorkspace(context, 'manage_members');
  return listPendingInvitations(context.db, context.workspaceId);
}

/**
 * Revoke a pending invitation. The same `invite` capability that can send one at a scope can
 * also withdraw one there, whoever sent it — consistent with a delegated capability meaning
 * "manage invitations here", not "manage only the ones I personally sent".
 */
export async function revokeInvitationById(
  context: InvitationContext,
  invitationId: string,
): Promise<void> {
  const invitation = await findInvitationById(context.db, invitationId);
  // Cross-workspace id and "never existed" are indistinguishable on purpose (T1).
  if (invitation === null || invitation.workspaceId !== context.workspaceId) throw notFound();

  const target: Target = {
    workspaceId: context.workspaceId,
    scopeType: invitation.scopeType,
    scopeId: invitation.scopeId,
  };
  await context.authz.assertCan(context.subject, 'invite', target);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    const row = await revokeInvitation(
      tx,
      context.workspaceId,
      invitationId,
      context.userId,
      clockOf(context)(),
    );
    if (row === null) {
      // Already accepted or already revoked since it was loaded above — the caller is looking
      // at their own workspace's list, so a plain refusal (not a 404-shaped one) is honest.
      throw conflict({ detail: 'invitation is no longer pending' });
    }
    await audit({
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: row.id,
      metadata: { scopeType: row.scopeType, scopeId: row.scopeId },
    });
  });
}
