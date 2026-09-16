import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, roleEnum, updatedAt, workspaceId } from './columns';
import { users } from './users';

/**
 * A workspace is the tenant.
 *
 * Not tenant-owned itself — it *is* the tenancy — so it carries no `workspace_id`, and the
 * schema test's allow-list names it.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    /** The person who created it. Ownership transfer is a later concern. */
    ownerUserId: reference('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('workspaces_owner_user_id_idx').on(table.ownerUserId)],
);

/**
 * Who belongs to a workspace, and what they may do at the top of it.
 *
 * `canDownload` and `canInvite` are independent booleans rather than role tiers, because
 * `docs/DESIGN.md` §3 makes them independent: a viewer may be permitted to download and an
 * editor may not. This row is the workspace-level baseline; anything more specific is a
 * `permission_grant` (task `022`), and resolution happens only in `packages/authz`.
 */
export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    canDownload: boolean('can_download').notNull().default(true),
    canInvite: boolean('can_invite').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One membership per person per workspace. Two rows would make the effective role
    // depend on row order, which is not a decision anyone made.
    uniqueIndex('workspace_memberships_workspace_user_key').on(table.workspaceId, table.userId),
    // Workspace first: every query here is "who is in this workspace", never "where is this
    // user a member" without a tenant already in hand.
    index('workspace_memberships_workspace_role_idx').on(table.workspaceId, table.role),
    index('workspace_memberships_user_idx').on(table.userId),
  ],
);
