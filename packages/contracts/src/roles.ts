/**
 * Roles and capabilities.
 *
 * Defined once here and imported by `authz`, the API, and the UI, so the three cannot drift.
 * See docs/DESIGN.md §3 for the authoritative definitions.
 *
 * Download and invite are **independent booleans**, not implied by role. A viewer may be
 * permitted to download; an editor may not. Encoding them as role tiers would lose that.
 */

import { z } from 'zod';

export const ROLES = ['viewer', 'commenter', 'editor', 'owner'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Roles an invitation may carry. Never `owner` — owner is "full workspace administration,
 * billing, deletion/recovery, audit access, and permission management" (`docs/DESIGN.md` §3),
 * a workspace-wide role that lives on `workspace_memberships` and is never delegated through a
 * folder/project/song grant. An invitation that could name `owner` would let a `can_invite`
 * delegate mint a co-owner of the whole workspace from a single-song scope (task `032`).
 */
export const INVITABLE_ROLES = ['viewer', 'commenter', 'editor'] as const;
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

/**
 * Role ordering, for "at least" comparisons only.
 *
 * This is a convenience for the common case and is NOT the authorization decision — that
 * lives in `packages/authz`, which resolves the scope chain, applies most-specific-wins, and
 * honours explicit denies (ADR 0006). Never compare these numbers in a route handler.
 */
const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

/** True when `role` is at least `minimum` in the tier ordering. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Capabilities resolved independently of role. */
export const capabilitiesSchema = z.object({
  canDownload: z.boolean(),
  canInvite: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** The scope a permission grant targets. Grants inherit downward from folder to song. */
export const GRANT_SCOPES = ['folder', 'project', 'song'] as const;
export const grantScopeSchema = z.enum(GRANT_SCOPES);
export type GrantScope = z.infer<typeof grantScopeSchema>;

/** The kinds of subject that can hold access. Share links resolve on a separate path. */
export const SUBJECT_KINDS = ['member', 'sync_token', 'share_link', 'anonymous'] as const;
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export type SubjectKind = z.infer<typeof subjectKindSchema>;

/** Effective access after resolution. Produced only by `packages/authz`. */
export const effectiveAccessSchema = z.object({
  role: roleSchema.nullable(),
  canDownload: z.boolean(),
  canInvite: z.boolean(),
});
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>;

/** Deny-by-default access, used when no grant produces any. */
export const NO_ACCESS: EffectiveAccess = {
  role: null,
  canDownload: false,
  canInvite: false,
};
