import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import type { Database } from '../client';
import { assets } from '../schema/assets';
import {
  notificationPreferences,
  notifications,
  notificationSettings,
  type NotificationDetail,
} from '../schema/notifications';
import { assetVersions, mixVersions } from '../schema/versions';

/**
 * Notifications (task `095`): the rows, and nothing about who may see what — that is decided by
 * the caller when they are written and again when they are read.
 */

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/** Unread or read, a notification older than this is gone. */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** A read one goes sooner: it has done its job. */
export const READ_NOTIFICATION_RETENTION_DAYS = 30;
/** The most one list reads. Older ones still exist until retention takes them. */
export const NOTIFICATION_LIST_LIMIT = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function insertNotifications(
  db: Database,
  rows: readonly NewNotification[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(notifications).values([...rows]);
}

/** This person's notifications here — and their invitations, from wherever they were sent. */
function mine(workspaceId: string, recipientId: string) {
  return and(
    eq(notifications.recipientId, recipientId),
    or(eq(notifications.workspaceId, workspaceId), eq(notifications.targetType, 'invitation')),
  );
}

export async function recentNotificationsFor(
  db: Database,
  workspaceId: string,
  recipientId: string,
  limit = NOTIFICATION_LIST_LIMIT,
): Promise<NotificationRow[]> {
  return (
    db
      .select()
      .from(notifications)
      // Rows kept only to be emailed are not listed.
      .where(and(mine(workspaceId, recipientId), eq(notifications.inApp, true)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
  );
}

/** Mark some — or, with `'all'`, every — notification of this person's read. */
export async function markNotificationsRead(
  db: Database,
  workspaceId: string,
  recipientId: string,
  ids: readonly string[] | 'all',
  now: Date,
): Promise<number> {
  if (ids !== 'all' && ids.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        mine(workspaceId, recipientId),
        isNull(notifications.readAt),
        ids === 'all' ? undefined : inArray(notifications.id, [...ids]),
      ),
    )
    .returning();
  return updated.length;
}

/** Retention: drop this person's old notifications, and read ones sooner. */
export async function pruneNotifications(
  db: Database,
  recipientId: string,
  now: Date,
): Promise<void> {
  const oldest = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const oldestRead = new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * DAY_MS);
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        or(lt(notifications.createdAt, oldest), lt(notifications.readAt, oldestRead)),
      ),
    );
}

/**
 * A media job finished a version, or gave up on it (task `064`): tell the person who uploaded it,
 * who is the one waiting. Nothing if the uploader's account is gone. Whether they can still see
 * the song or project is checked when they read it, like every notification.
 */
export async function recordProcessingNotification(
  db: Database,
  input: {
    readonly workspaceId: string;
    readonly assetVersionId: string;
    readonly event: 'version.processed' | 'version.processing_failed';
    readonly id: string;
  },
): Promise<boolean> {
  const [version] = await db
    .select({
      uploadedBy: assetVersions.uploadedBy,
      songId: assets.songId,
      projectId: assets.projectId,
      kind: assets.kind,
      mixVersionId: mixVersions.id,
    })
    .from(assetVersions)
    .innerJoin(
      assets,
      and(eq(assets.id, assetVersions.assetId), eq(assets.workspaceId, assetVersions.workspaceId)),
    )
    .leftJoin(
      mixVersions,
      and(
        eq(mixVersions.assetVersionId, assetVersions.id),
        eq(mixVersions.workspaceId, assetVersions.workspaceId),
      ),
    )
    .where(
      and(
        eq(assetVersions.id, input.assetVersionId),
        eq(assetVersions.workspaceId, input.workspaceId),
      ),
    );
  // A voice note's processing is its comment's business, not a notification of its own.
  if (version?.uploadedBy == null || version.kind === 'voice_note') return false;
  const target =
    version.songId !== null
      ? ({ targetType: 'song', targetId: version.songId } as const)
      : version.projectId !== null
        ? ({ targetType: 'project', targetId: version.projectId } as const)
        : null;
  if (target === null) return false;
  const detail: NotificationDetail =
    version.mixVersionId === null
      ? { assetVersionId: input.assetVersionId }
      : { assetVersionId: input.assetVersionId, mixVersionId: version.mixVersionId };
  await insertNotifications(db, [
    {
      id: input.id,
      workspaceId: input.workspaceId,
      recipientId: version.uploadedBy,
      // The system did this, not a person.
      actorId: null,
      event: input.event,
      ...target,
      groupKey: `${input.event}:${input.assetVersionId}`,
      detail,
    },
  ]);
  return true;
}

export type PreferenceRow = typeof notificationPreferences.$inferSelect;

/** Saved preferences for these people. A missing row is the default. */
export async function preferencesOf(
  db: Database,
  userIds: readonly string[],
): Promise<PreferenceRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, [...userIds]));
}

/** Each person's email mode; `immediate` when never set. */
export async function emailModesOf(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, 'immediate' | 'daily'>> {
  const modes = new Map<string, 'immediate' | 'daily'>();
  if (userIds.length === 0) return modes;
  const rows = await db
    .select({ userId: notificationSettings.userId, mode: notificationSettings.emailMode })
    .from(notificationSettings)
    .where(inArray(notificationSettings.userId, [...userIds]));
  for (const row of rows) modes.set(row.userId, row.mode);
  return modes;
}

/** Save a person's choices: each given event and channel, and their email mode if given. */
export async function savePreferences(
  db: Database,
  userId: string,
  changes: readonly {
    readonly event: string;
    readonly channel: 'in_app' | 'email';
    readonly enabled: boolean;
  }[],
  emailMode: 'immediate' | 'daily' | undefined,
  newId: () => string,
): Promise<void> {
  for (const change of changes) {
    await db
      .insert(notificationPreferences)
      .values({ id: newId(), userId, ...change })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.event,
          notificationPreferences.channel,
        ],
        set: { enabled: change.enabled, updatedAt: new Date() },
      });
  }
  if (emailMode !== undefined) {
    await db
      .insert(notificationSettings)
      .values({ userId, emailMode })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: { emailMode, updatedAt: new Date() },
      });
  }
}

/** Email that is waiting to go: one person's, or everyone's created before a moment. */
export async function pendingEmailNotifications(
  db: Database,
  filter: {
    readonly recipientId?: string;
    readonly createdBefore?: Date;
    readonly ids?: readonly string[];
  },
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.emailStatus, 'pending'),
        filter.recipientId === undefined
          ? undefined
          : eq(notifications.recipientId, filter.recipientId),
        filter.createdBefore === undefined
          ? undefined
          : lt(notifications.createdAt, filter.createdBefore),
        filter.ids === undefined ? undefined : inArray(notifications.id, [...filter.ids]),
      ),
    )
    .orderBy(notifications.recipientId, desc(notifications.createdAt))
    .limit(2_000);
}

/** Record what became of pending email. Only rows still pending change: a retry cannot resend. */
export async function settleEmail(
  db: Database,
  ids: readonly string[],
  status: 'sent' | 'skipped',
  now: Date,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(notifications)
    .set({ emailStatus: status, emailedAt: now })
    .where(and(inArray(notifications.id, [...ids]), eq(notifications.emailStatus, 'pending')))
    .returning();
  return rows.map((row) => row.id);
}

/** Mark a digest sent for a person. */
export async function recordDigest(db: Database, userId: string, now: Date): Promise<void> {
  await db
    .insert(notificationSettings)
    .values({ userId, emailMode: 'daily', lastDigestAt: now })
    .onConflictDoUpdate({ target: notificationSettings.userId, set: { lastDigestAt: now } });
}
