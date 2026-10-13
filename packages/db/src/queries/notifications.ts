import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  ALWAYS_IN_APP,
  defaultPreference,
  notificationEventSchema,
} from '@youandfriends/contracts';

import type { Database } from '../client';
import {
  notificationEmails,
  notificationPreferences,
  notifications,
} from '../schema/notifications';
import { users } from '../schema/users';
import { workspaces } from '../schema/workspaces';

/**
 * Notification rows (task `095`). Writing folds into an unread group; reading returns raw rows,
 * and the caller filters them by the reader's access **now** — never trust that access at
 * generation time still holds.
 */

/** Events that fold together on one target: every kind of new comment is "comments". */
const FAMILY: Readonly<Record<string, string>> = {
  'comment.created': 'comment',
  'comment.replied': 'comment',
  'voice_note.created': 'comment',
};

export function notificationGroupKey(event: string, targetType: string, targetId: string): string {
  return `${FAMILY[event] ?? event}:${targetType}:${targetId}`;
}

/** Where a notification leads, beyond the target itself. */
export interface NotificationLink {
  readonly threadId?: string | undefined;
  readonly versionId?: string | undefined;
  readonly anchor?: 'general' | 'timestamp' | 'lyric' | undefined;
  readonly tab?: 'overview' | 'lyrics' | 'files' | 'activity' | undefined;
}

export interface NotificationItem {
  readonly event: string;
  readonly actorId: string | null;
  readonly preview: string | null;
  readonly link: NotificationLink | null;
  readonly at: string;
}

export interface RecordNotificationsInput {
  readonly workspaceId: string;
  readonly recipientIds: readonly string[];
  readonly event: string;
  readonly targetType: 'song' | 'project' | 'workspace';
  readonly targetId: string;
  readonly actorId: string | null;
  readonly preview?: string | null | undefined;
  readonly link?: NotificationLink | null | undefined;
  readonly at: Date;
  readonly newId: () => string;
}

/** How many folded events a row keeps to show when expanded. */
export const NOTIFICATION_ITEMS_KEPT = 5;
/** Read notifications older than this are removed. */
export const NOTIFICATION_READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** At most this many rows are kept per person per workspace; the oldest go first. */
export const NOTIFICATION_ROWS_KEPT = 200;

/**
 * Record one event for each recipient: a new unread row, or folded into the recipient's unread
 * row for the same group. Folding is an upsert on the partial unique index, so two events racing
 * still end as one row with both counted.
 */
export async function recordNotifications(
  db: Database,
  input: RecordNotificationsInput,
): Promise<void> {
  if (input.recipientIds.length === 0) return;
  const groupKey = notificationGroupKey(input.event, input.targetType, input.targetId);
  const item: NotificationItem = {
    event: input.event,
    actorId: input.actorId,
    preview: input.preview ?? null,
    link: input.link ?? null,
    at: input.at.toISOString(),
  };
  for (const recipientId of new Set(input.recipientIds)) {
    await db
      .insert(notifications)
      .values({
        id: input.newId(),
        workspaceId: input.workspaceId,
        recipientId,
        event: input.event,
        targetType: input.targetType,
        targetId: input.targetId,
        groupKey,
        actorId: input.actorId,
        count: 1,
        items: [item],
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: [notifications.workspaceId, notifications.recipientId, notifications.groupKey],
        targetWhere: sql`read_at is null`,
        set: {
          event: input.event,
          actorId: input.actorId,
          count: sql`${notifications.count} + 1`,
          items: sql`(
            select coalesce(jsonb_agg(element order by position), '[]'::jsonb)
            from jsonb_array_elements(${JSON.stringify([item])}::jsonb || ${notifications.items})
              with ordinality as folded(element, position)
            where position <= ${NOTIFICATION_ITEMS_KEPT}
          )`,
          updatedAt: input.at,
        },
      });
  }
  await pruneNotifications(db, input.workspaceId, [...new Set(input.recipientIds)], input.at);
}

/** Retention: read rows past their time go, and nobody keeps more than the cap. */
export async function pruneNotifications(
  db: Database,
  workspaceId: string,
  recipientIds: readonly string[],
  now: Date,
): Promise<void> {
  if (recipientIds.length === 0) return;
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        inArray(notifications.recipientId, [...recipientIds]),
        lt(notifications.readAt, new Date(now.getTime() - NOTIFICATION_READ_RETENTION_MS)),
      ),
    );
  for (const recipientId of recipientIds) {
    const keep = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.workspaceId, workspaceId), eq(notifications.recipientId, recipientId)),
      )
      .orderBy(desc(notifications.updatedAt), desc(notifications.id))
      .limit(NOTIFICATION_ROWS_KEPT);
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.recipientId, recipientId),
          notInArray(notifications.id, keep),
        ),
      );
  }
}

export interface NotificationRow {
  readonly id: string;
  readonly event: string;
  readonly targetType: 'song' | 'project' | 'workspace';
  readonly targetId: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly count: number;
  readonly items: readonly NotificationItem[];
  readonly readAt: Date | null;
  readonly updatedAt: Date;
}

/** One person's notifications in one workspace, newest first. Not yet filtered by access. */
export async function listNotificationRows(
  db: Database,
  workspaceId: string,
  recipientId: string,
  options: { readonly unreadOnly?: boolean; readonly limit?: number } = {},
): Promise<NotificationRow[]> {
  const rows = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      targetType: notifications.targetType,
      targetId: notifications.targetId,
      actorId: notifications.actorId,
      actorName: users.displayName,
      count: notifications.count,
      items: notifications.items,
      readAt: notifications.readAt,
      updatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.recipientId, recipientId),
        options.unreadOnly === true ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.updatedAt), desc(notifications.id))
    .limit(options.limit ?? NOTIFICATION_ROWS_KEPT);
  return rows.map((row) => ({
    ...row,
    items: Array.isArray(row.items) ? (row.items as NotificationItem[]) : [],
  }));
}

/**
 * Mark someone's notifications read: the ones named, or all of them. Only their own — the
 * recipient is part of the filter, so another person's id names nothing.
 */
export async function markNotificationsRead(
  db: Database,
  workspaceId: string,
  recipientId: string,
  ids: readonly string[] | 'all',
  at: Date,
): Promise<number> {
  if (ids !== 'all' && ids.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set({ readAt: at })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt),
        ids === 'all' ? undefined : inArray(notifications.id, [...ids]),
      ),
    )
    .returning();
  return updated.length;
}

/**
 * Mark notifications unread again — only rows whose group has no other unread row, since the
 * partial unique index allows one unread row per group.
 */
export async function markNotificationsUnread(
  db: Database,
  workspaceId: string,
  recipientId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set({ readAt: null })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.recipientId, recipientId),
        inArray(notifications.id, [...ids]),
        sql`not exists (
          select 1 from notifications other
          where other.workspace_id = ${notifications.workspaceId}
            and other.recipient_id = ${notifications.recipientId}
            and other.group_key = ${notifications.groupKey}
            and other.read_at is null
        )`,
      ),
    )
    .returning();
  return updated.length;
}

export interface StoredPreference {
  readonly event: string;
  readonly inApp: boolean;
  readonly email: 'off' | 'immediate' | 'digest';
}

/** One person's stored preferences in a workspace. Events without a row use the defaults. */
export async function listPreferenceRows(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<StoredPreference[]> {
  return db
    .select({
      event: notificationPreferences.event,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.workspaceId, workspaceId),
        eq(notificationPreferences.userId, userId),
      ),
    );
}

/** These people's stored preference for one event, by user id. Absent means the default. */
export async function preferencesForEvent(
  db: Database,
  workspaceId: string,
  userIds: readonly string[],
  event: string,
): Promise<Map<string, StoredPreference>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      event: notificationPreferences.event,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.workspaceId, workspaceId),
        inArray(notificationPreferences.userId, [...userIds]),
        eq(notificationPreferences.event, event),
      ),
    );
  return new Map(rows.map((row) => [row.userId, row]));
}

/** Save someone's choices, one row per event, replacing what was there. */
export async function savePreferenceRows(
  db: Database,
  workspaceId: string,
  userId: string,
  rows: readonly StoredPreference[],
  newId: () => string,
  at: Date,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(notificationPreferences)
      .values({
        id: newId(),
        workspaceId,
        userId,
        event: row.event,
        inApp: row.inApp,
        email: row.email,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.workspaceId,
          notificationPreferences.userId,
          notificationPreferences.event,
        ],
        set: { inApp: row.inApp, email: row.email, updatedAt: at },
      });
  }
}

export interface QueueEmailInput {
  readonly workspaceId: string;
  readonly recipientId: string;
  readonly event: string;
  readonly targetType: 'song' | 'project' | 'workspace';
  readonly targetId: string;
  readonly actorId: string | null;
  readonly link: NotificationLink | null;
  readonly mode: 'immediate' | 'digest';
}

/** Put emails in the outbox. Sending is the worker's (task `096`). */
export async function queueNotificationEmails(
  db: Database,
  rows: readonly QueueEmailInput[],
  newId: () => string,
  at: Date,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(notificationEmails).values(
    rows.map((row) => ({
      id: newId(),
      workspaceId: row.workspaceId,
      recipientId: row.recipientId,
      event: row.event,
      targetType: row.targetType,
      targetId: row.targetId,
      actorId: row.actorId,
      link: row.link,
      mode: row.mode,
      createdAt: at,
    })),
  );
}

export interface QueuedEmailRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly recipientId: string;
  readonly recipientEmail: string;
  readonly event: string;
  readonly targetType: 'song' | 'project' | 'workspace';
  readonly targetId: string;
  readonly actorName: string | null;
  readonly link: NotificationLink | null;
  readonly attempts: number;
  readonly createdAt: Date;
}

/** Queued emails of one mode, oldest first, with what sending them needs. All workspaces. */
export async function listQueuedEmails(
  db: Database,
  mode: 'immediate' | 'digest',
  limit = 500,
): Promise<QueuedEmailRow[]> {
  const actor = alias(users, 'actor');
  const rows = await db
    .select({
      id: notificationEmails.id,
      workspaceId: notificationEmails.workspaceId,
      workspaceName: workspaces.name,
      recipientId: notificationEmails.recipientId,
      recipientEmail: users.email,
      event: notificationEmails.event,
      targetType: notificationEmails.targetType,
      targetId: notificationEmails.targetId,
      actorName: actor.displayName,
      link: notificationEmails.link,
      attempts: notificationEmails.attempts,
      createdAt: notificationEmails.createdAt,
    })
    .from(notificationEmails)
    .innerJoin(users, eq(users.id, notificationEmails.recipientId))
    .innerJoin(workspaces, eq(workspaces.id, notificationEmails.workspaceId))
    .leftJoin(actor, eq(actor.id, notificationEmails.actorId))
    .where(and(eq(notificationEmails.mode, mode), eq(notificationEmails.status, 'queued')))
    .orderBy(notificationEmails.createdAt, notificationEmails.id)
    .limit(limit);
  return rows.map((row) => ({ ...row, link: (row.link ?? null) as NotificationLink | null }));
}

/** Record what became of these emails. A failure below the retry limit stays queued. */
export async function settleEmails(
  db: Database,
  ids: readonly string[],
  outcome: 'sent' | 'dropped' | 'failed' | 'retry',
  at: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notificationEmails)
    .set(
      outcome === 'retry'
        ? { attempts: sql`${notificationEmails.attempts} + 1` }
        : {
            status: outcome,
            attempts: sql`${notificationEmails.attempts} + 1`,
            ...(outcome === 'sent' ? { sentAt: at } : {}),
          },
    )
    .where(inArray(notificationEmails.id, [...ids]));
}

/**
 * Deliver one event to people who may already be decided to hear it (task `096`): each one's
 * preferences decide whether it goes in-app (always, for the events that must not be missed) and
 * whether, and how, it is emailed. Email is queued only when email delivery is configured — with
 * no provider, nothing is queued that could never be sent.
 */
export async function deliverNotification(
  db: Database,
  input: RecordNotificationsInput & { readonly emailAvailable: boolean },
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)];
  if (recipients.length === 0) return;
  const event = notificationEventSchema.safeParse(input.event);
  if (!event.success) return;
  const stored = await preferencesForEvent(db, input.workspaceId, recipients, input.event);
  const fallback = defaultPreference(event.data);
  const preferenceOf = (userId: string) => stored.get(userId) ?? fallback;
  const required = ALWAYS_IN_APP.includes(event.data);
  await recordNotifications(db, {
    ...input,
    recipientIds: recipients.filter((userId) => required || preferenceOf(userId).inApp),
  });
  if (!input.emailAvailable) return;
  const emails: QueueEmailInput[] = [];
  for (const userId of recipients) {
    const mode = preferenceOf(userId).email;
    if (mode === 'off') continue;
    emails.push({
      workspaceId: input.workspaceId,
      recipientId: userId,
      event: input.event,
      targetType: input.targetType,
      targetId: input.targetId,
      actorId: input.actorId,
      link: input.link ?? null,
      mode,
    });
  }
  await queueNotificationEmails(db, emails, input.newId, input.at);
}
