import { index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from './columns';

/**
 * A person, and the mapping to their Clerk identity.
 *
 * **Not tenant-owned.** A user exists across workspaces, so there is no `workspace_id` here;
 * what ties a person to a tenant is `workspace_memberships`. The schema test's allow-list
 * names this table for exactly that reason.
 *
 * Clerk owns authentication; this row owns everything the product needs to show a person to
 * their collaborators without a round trip to Clerk on every render. The profile fields are a
 * cache of Clerk's, refreshed by the webhook in task `030` — never the source of truth.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    /** Clerk's `user_id`. The join key for every session. */
    clerkUserId: varchar('clerk_user_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One row per Clerk identity. A duplicate would silently split a person's memberships
    // in half, and they would lose access to their own work.
    uniqueIndex('users_clerk_user_id_key').on(table.clerkUserId),
    index('users_email_idx').on(table.email),
  ],
);
