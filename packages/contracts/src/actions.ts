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
