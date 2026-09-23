import {
  grantScopeSchema,
  invitableRoleSchema,
  roleAtLeast,
  type EffectiveAccess,
  type GrantScope,
  type InvitableRole,
} from '@youandfriends/contracts';
import { z } from 'zod';

/**
 * Deciding what an invitation may offer, given what the person sending it can already do.
 *
 * Pure, and deliberately separate from anything that touches a database, the same reasoning as
 * `resolve.ts`: the rule is exercised by direct cases rather than fixtures, so a bug in it is
 * not entangled with a bug in how a target was loaded.
 */

/**
 * How the invitee's email reaches storage and comparison: lowercased and trimmed.
 *
 * Acceptance compares this against Clerk's own email for the signed-in identity
 * (`docs/THREAT_MODEL.md` T2) — a case difference between the two must never be the reason a
 * legitimate acceptance fails, and must never be a way to bypass the binding either, so both
 * sides of that comparison go through the same normalization.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const inviteRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address.')
    .max(320, 'That address is too long.'),
  scopeType: grantScopeSchema,
  scopeId: z.string().min(1),
  role: invitableRoleSchema,
  canDownload: z.boolean(),
  canInvite: z.boolean(),
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

/**
 * Whether someone with `inviterAccess` at a target may offer `requested` there.
 *
 * **An invitation cannot grant more than its sender already has.** `docs/DESIGN.md` §3 lets an
 * owner delegate the *capability* to invite, but delegating `can_invite` is not delegating the
 * authority to grant editor everywhere a commenter-with-`can_invite` happens to have a foothold
 * — that would let a delegate mint access beyond their own reach, which is exactly the
 * escalation `docs/THREAT_MODEL.md` T2 names. So the cap is symmetric across every facet: the
 * requested role is capped by `roleAtLeast`, and each capability is capped by whether the
 * inviter holds it themselves. A capability an inviter lacks cannot be handed onward, even one
 * they are not personally exercising at this scope.
 *
 * Requires the inviter to hold a role at all — `assertCan(subject, 'invite', target)` is what
 * establishes that (`ACTION_REQUIREMENTS.invite` already requires `canInvite`), and this
 * function trusts that has already run; it only decides what the invitation may then contain.
 */
export function canGrantAccess(
  inviterAccess: EffectiveAccess,
  requested: {
    readonly role: InvitableRole;
    readonly canDownload: boolean;
    readonly canInvite: boolean;
  },
): boolean {
  if (inviterAccess.role === null) return false;
  if (!roleAtLeast(inviterAccess.role, requested.role)) return false;
  if (requested.canDownload && !inviterAccess.canDownload) return false;
  if (requested.canInvite && !inviterAccess.canInvite) return false;
  return true;
}

/** Structured reasons `canGrantAccess` might refuse, for a message worth showing the inviter. */
export function describeGrantRefusal(
  inviterAccess: EffectiveAccess,
  requested: {
    readonly role: InvitableRole;
    readonly canDownload: boolean;
    readonly canInvite: boolean;
  },
): string {
  if (inviterAccess.role === null) return 'You do not have access here yourself.';
  if (!roleAtLeast(inviterAccess.role, requested.role)) {
    return `You cannot invite someone to a higher role than your own (${inviterAccess.role}).`;
  }
  if (requested.canDownload && !inviterAccess.canDownload) {
    return 'You cannot grant download access you do not have yourself.';
  }
  if (requested.canInvite && !inviterAccess.canInvite) {
    return 'You cannot grant invite access you do not have yourself.';
  }
  return 'That invitation is not something you can send.';
}

export type { GrantScope };
