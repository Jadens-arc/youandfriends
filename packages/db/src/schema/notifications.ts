import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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
    /**
     * Shown in the list (task `096`). False when its reader switched this event off in-app but
     * still wants it by email: the row exists to be emailed, not to be listed.
     */
    inApp: boolean('in_app').notNull().default(true),
    /**
     * Email delivery (task `096`): null — not for email; `pending` — to send; `sent`; `skipped` —
     * at send time the reader could no longer see it, or no longer wanted it.
     */
    emailStatus: text('email_status', { enum: ['pending', 'sent', 'skipped'] }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
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
    check(
      'notifications_email_status_known',
      sql`email_status is null or email_status in ('pending', 'sent', 'skipped')`,
    ),
    // What the email sender scans for.
    index('notifications_email_pending_idx')
      .on(table.recipientId, table.createdAt)
      .where(sql`email_status = 'pending'`),
  ],
);

/** Where a notification lands. Ids only — never words, never URLs. */
export interface NotificationDetail {
  readonly threadId?: string;
  readonly commentId?: string;
  readonly mixVersionId?: string;
  readonly assetVersionId?: string;
}

/**
 * A person's choices about what they hear, by event and channel (task `096`). A missing row means
 * the default (`NOTIFICATION_DEFAULTS`). A person's own settings, across every workspace they are
 * in — not a tenant's content — so no `workspace_id`.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    channel: text('channel', { enum: ['in_app', 'email'] }).notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('notification_preferences_key').on(table.userId, table.event, table.channel),
    check('notification_preferences_channel_known', sql`channel in ('in_app', 'email')`),
  ],
);

/** How a person takes email: each as it happens, or one a day. */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: reference('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailMode: text('email_mode', { enum: ['immediate', 'daily'] })
      .notNull()
      .default('immediate'),
    /** When the last daily digest went, so the next covers only what came after. */
    lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  () => [check('notification_settings_mode_known', sql`email_mode in ('immediate', 'daily')`)],
);
