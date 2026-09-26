import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * One thing one person may want to hear about (task `095`).
 *
 * A row per recipient per event: who, what happened, to what, by whom. **Content is not copied
 * here.** A comment's words are read from the comment when the list is shown, so a deleted comment
 * disappears from notifications too, and a notification about a song someone can no longer see is
 * filtered out when read — access is checked at generation *and* at read (`docs/THREAT_MODEL.md`
 * T1, T2).
 *
 * `group_key` is how related notifications fold into one row: ten comments on a song, one entry.
 * `detail` says where exactly to land — the thread, the comment, the version.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    recipientId: reference('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: reference('actor_id').references(() => users.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    targetType: text('target_type', {
      enum: ['song', 'project', 'workspace', 'invitation'],
    }).notNull(),
    targetId: reference('target_id').notNull(),
    groupKey: text('group_key').notNull(),
    detail: jsonb('detail').$type<NotificationDetail>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('notifications_recipient_idx').on(table.workspaceId, table.recipientId, table.createdAt),
    index('notifications_unread_idx')
      .on(table.workspaceId, table.recipientId)
      .where(sql`read_at is null`),
    // Invitations are shown to their recipient from whichever workspace they are in.
    index('notifications_invitations_idx')
      .on(table.recipientId, table.createdAt)
      .where(sql`target_type = 'invitation'`),
    check(
      'notifications_target_known',
      sql`target_type in ('song', 'project', 'workspace', 'invitation')`,
    ),
    check('notifications_not_to_self', sql`actor_id is null or actor_id <> recipient_id`),
  ],
);

/** Where a notification lands. Ids only — never words, never URLs. */
export interface NotificationDetail {
  readonly threadId?: string;
  readonly commentId?: string;
  readonly mixVersionId?: string;
  readonly assetVersionId?: string;
}
