/**
 * What a subject may be trying to do.
 *
 * `assertCan(subject, action, target)` takes one of these rather than a role, because the
 * caller knows what it is about to do and should not have to know which role that requires.
 * Keeping the mapping here means changing "commenting requires a commenter" is one edit, not
 * a search through route handlers — which is the same reason roles live here at all.
 *
 * Download and invite are **not** role tiers. They map to independent capabilities, so a
 * viewer permitted to download passes `download` while an editor without it fails
 * (`docs/DESIGN.md` §3).
 */

import { z } from 'zod';

import { type Capabilities, type Role } from './roles';

export const ACTIONS = ['view', 'comment', 'edit', 'manage', 'download', 'invite'] as const;

export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;

/**
 * What each action requires: a minimum role, and optionally a capability alongside it.
 *
 * Every action requires at least `viewer`, including the capability-gated ones. A capability
 * is permission to do something *with* a resource you can already see; it is not a way to
 * reach one you cannot.
 */
export const ACTION_REQUIREMENTS: Readonly<
  Record<Action, { readonly minimumRole: Role; readonly capability?: keyof Capabilities }>
> = {
  view: { minimumRole: 'viewer' },
  comment: { minimumRole: 'commenter' },
  edit: { minimumRole: 'editor' },
  /** Renaming, deleting, moving, and granting access. */
  manage: { minimumRole: 'owner' },
  download: { minimumRole: 'viewer', capability: 'canDownload' },
  invite: { minimumRole: 'viewer', capability: 'canInvite' },
};

/**
 * What a subject may do to the **workspace itself**, rather than to something inside it.
 *
 * A separate vocabulary because the target is different in kind. `ACTIONS` resolve through a
 * scope chain — song → project → folder → workspace — where a grant at any level can widen or
 * deny. The workspace's own settings and its member list sit above every chain and belong to
 * nothing a grant can be attached to, so only the membership row answers them. Routing them
 * through `assertCan` would mean inventing a scope for the workspace, and an invented scope is
 * one no grant, test, or reviewer validates (the same reasoning as `assertWorkspaceOwner`).
 *
 * Member management is owner-only. The member list is sensitive — it is who works with whom,
 * on unreleased music (`docs/THREAT_MODEL.md`, asset 3) — so seeing it at all needs membership,
 * and changing it needs ownership (`docs/DESIGN.md` §3: "permission management" is an owner
 * ability). Delegated invitation is the separate `canInvite` capability, arriving in task `032`.
 */
export const WORKSPACE_ACTIONS = ['view_settings', 'rename', 'manage_members'] as const;

export const workspaceActionSchema = z.enum(WORKSPACE_ACTIONS);
export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;

export const WORKSPACE_ACTION_REQUIREMENTS: Readonly<
  Record<WorkspaceAction, { readonly minimumRole: Role }>
> = {
  view_settings: { minimumRole: 'viewer' },
  rename: { minimumRole: 'owner' },
  manage_members: { minimumRole: 'owner' },
};
