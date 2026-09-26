import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import type { Database } from '../client';
import { assets } from '../schema/assets';
import { notifications, type NotificationDetail } from '../schema/notifications';
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
  return db
    .select()
    .from(notifications)
    .where(mine(workspaceId, recipientId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
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
