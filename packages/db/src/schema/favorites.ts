import { index, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, favoriteTargetEnum, id, reference, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * A person's favourites, per workspace.
 *
 * Polymorphic by `targetType` + `targetId` rather than three nullable foreign keys. The
 * trade is deliberate: a polymorphic target cannot be enforced by a foreign key, so a
 * deleted song can leave a dangling favourite. Three nullable columns with three FKs would
 * enforce it, at the cost of a CHECK constraint asserting exactly one is set, and of every
 * read branching on which one it is. A dangling favourite is a row the UI skips; the
 * alternative complicates the hot path to prevent a harmless orphan. Task `025`'s soft
 * deletion sweeps them.
 */
export const favorites = pgTable(
  'favorites',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: favoriteTargetEnum('target_type').notNull(),
    targetId: reference('target_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Favouriting twice is the same as favouriting once.
    uniqueIndex('favorites_unique_key').on(
      table.workspaceId,
      table.userId,
      table.targetType,
      table.targetId,
    ),
    // The Favorites destination: one person's favourites in one workspace, newest first.
    index('favorites_workspace_user_idx').on(table.workspaceId, table.userId, table.createdAt),
  ],
);
