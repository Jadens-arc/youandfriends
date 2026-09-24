import { index, pgEnum, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { favoriteTargetEnum, id, reference, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

export const RECENT_KINDS = ['viewed', 'played'] as const;
export const recentKindEnum = pgEnum('recent_kind', RECENT_KINDS);

/**
 * What one person recently opened or listened to, per workspace (task `044`).
 *
 * One row per (person, kind, target), moved forward on each new occurrence rather than appended
 * — a history table would grow with every page view, and "recent" only ever needs the latest
 * time. The write path debounces (a revisit within minutes is not written at all) and caps the
 * list per person, so the table stays proportional to people, not to clicks.
 *
 * Polymorphic target like `favorites`, for the same reason and with the same consequence: a
 * deleted song can leave a row behind, which the read drops rather than shows.
 */
export const recents = pgTable(
  'recents',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: recentKindEnum('kind').notNull(),
    targetType: favoriteTargetEnum('target_type').notNull(),
    targetId: reference('target_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('recents_unique_key').on(
      table.workspaceId,
      table.userId,
      table.kind,
      table.targetType,
      table.targetId,
    ),
    index('recents_workspace_user_idx').on(
      table.workspaceId,
      table.userId,
      table.kind,
      table.occurredAt,
    ),
  ],
);
