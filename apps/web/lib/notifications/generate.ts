import { loadTargetAudience } from '@youandfriends/authz';
import { newUlid, type WorkspaceId } from '@youandfriends/contracts';
import { deliverNotification, workspaceMemberships, type DirectDatabase } from '@youandfriends/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { NotificationSink } from './sink';

/**
 * The one place domain events become notifications (task `095`).
 *
 * - **Who hears.** Everyone who can open the target now, or — for an addressed event such as a
 *   mention — the people it names, still only if they can open the target. Access is decided by
 *   the same resolver every other read uses; it is checked again when the list is read.
 * - **Never the actor.** Being told about your own action reads as the system being confused.
 * - **As each person chose.** Their preferences (task `096`) decide in-app and email delivery.
 * - **Never fatal.** A notification that cannot be written must not undo the comment, upload,
 *   or edit that caused it: the failure is logged and the action stands.
 */

export interface NotifierOptions {
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  /** Whether to queue emails for people who asked for them (task `096`). Off unless configured. */
  readonly emailAvailable?: boolean | undefined;
}

/** Who can open a target right now — the authz package's answer (task `095`). */
export const audienceOf = loadTargetAudience;

/** Members of the workspace among these people — for addressed workspace events. */
async function membersAmong(
  db: DirectDatabase,
  workspaceId: WorkspaceId,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        inArray(workspaceMemberships.userId, [...userIds]),
      ),
    );
  return rows.map((row) => row.userId);
}

export function createNotifier(
  db: DirectDatabase,
  workspaceId: WorkspaceId,
  options: NotifierOptions = {},
): NotificationSink {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? newUlid;
  return async (event) => {
    try {
      const reach =
        event.targetType === 'workspace' && event.recipientIds !== undefined
          ? await membersAmong(db, workspaceId, event.recipientIds)
          : await audienceOf(db, workspaceId, event.targetType, event.targetId, now);
      const allowed = new Set(reach);
      const recipients = (event.recipientIds ?? reach).filter(
        (userId) => userId !== event.actorId && allowed.has(userId),
      );
      await deliverNotification(db, {
        emailAvailable: options.emailAvailable ?? false,
        workspaceId,
        recipientIds: recipients,
        event: event.event,
        targetType: event.targetType,
        targetId: event.targetId,
        actorId: event.actorId,
        preview: event.preview === undefined ? null : clip(event.preview),
        link: event.link ?? null,
        at: now(),
        newId,
      });
    } catch (error) {
      (options.onError ?? reportFailure)(error);
    }
  };
}

function reportFailure(error: unknown) {
  // Ids and the error's name only: a preview may hold someone's unreleased words.
  console.error('notification generation failed', {
    name: error instanceof Error ? error.name : typeof error,
  });
}

/** A preview is a glimpse, not a copy: one line, a hundred and twenty characters at most. */
export function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
