import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * One person's in-app notification (task `095`), **grouped**: while it is unread, further events
 * of the same kind on the same target fold into it — the count goes up and the newest few are
 * kept in `items` — so ten comments on one song are one row, not ten.
 *
 * The target is not a foreign key: a song or project may be trashed and purged, and the reader
 * filters by access anyway (access can be revoked between generation and reading). Rows about a
 * purged target are simply never shown, and retention removes them.
 *
 * Previews are a few words of what happened. They are text, rendered through React's escaping.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    recipientId: reference('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    targetType: text('target_type', { enum: ['song', 'project', 'workspace'] }).notNull(),
    targetId: reference('target_id').notNull(),
    /** What unread events fold together under: the kind of event and its target. */
    groupKey: text('group_key').notNull(),
    /** Who acted most recently. */
    actorId: reference('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** How many events this row stands for. */
    count: integer('count').notNull().default(1),
    /** The newest events folded in, newest first, at most five: `{ actorId, preview, link, at }`. */
    items: jsonb('items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** The newest event's time. Lists sort by it. */
    updatedAt: updatedAt(),
  },
  (table) => [
    index('notifications_recipient_idx').on(table.workspaceId, table.recipientId, table.updatedAt),
    // One unread row per group per person: the fold target, and what makes folding race-safe.
    uniqueIndex('notifications_unread_group_key')
      .on(table.workspaceId, table.recipientId, table.groupKey)
      .where(sql`read_at is null`),
    check('notifications_count_positive', sql`count >= 1`),
    check('notifications_target_type_known', sql`target_type in ('song', 'project', 'workspace')`),
  ],
);
