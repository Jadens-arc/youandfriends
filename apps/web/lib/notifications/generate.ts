import { loadProjectCollaborators, loadSongCollaborators } from '@youandfriends/authz';
import { newUlid, type WorkspaceId } from '@youandfriends/contracts';
import {
  getProjectHeader,
  getSongHeader,
  insertNotifications,
  membersOf,
  type DirectDatabase,
} from '@youandfriends/db';

import type { NotificationInput, NotificationSink } from './types';

/**
 * Turning domain events into notifications (task `095`).
 *
 * - **Who hears**: everyone who can see the target right now — or, for an addressed event, those
 *   of its addressees who can. Worked out with the same resolver as every access decision, so a
 *   deny on a song keeps its notifications from that person too.
 * - **Never the actor.** Also held by a database check.
 * - **Grouping** is decided here, by `group_key`: every comment on a song folds into one entry;
 *   a mention is always its own, because it is addressed to you.
 *
 * Runs after the change it describes has committed. A failure here is logged and swallowed: the
 * comment was posted, and saying otherwise would be false. The missing notification is the cost.
 */

function groupKeyOf(input: NotificationInput): string {
  switch (input.event) {
    case 'comment.created':
    case 'comment.replied':
    case 'voice_note.created':
      return `conversation:${input.targetType}:${input.targetId}`;
    case 'comment.mentioned':
      return `comment.mentioned:${input.detail?.commentId ?? input.targetId}`;
    case 'invitation.received':
      return `invitation:${input.targetId}`;
    default:
      return `${input.event}:${input.targetType}:${input.targetId}`;
  }
}

/** Who can see the target now; null for a target with no audience of its own (an invitation). */
async function audienceOf(
  db: DirectDatabase,
  workspaceId: string,
  input: NotificationInput,
  now: () => Date,
): Promise<Set<string> | null | 'gone'> {
  const workspace = workspaceId as WorkspaceId;
  switch (input.targetType) {
    case 'song': {
      const song = await getSongHeader(db, workspaceId, input.targetId);
      if (song === null) return 'gone';
      return new Set(
        await loadSongCollaborators(
          db,
          workspace,
          { id: song.id, projectId: song.projectId, folderPath: song.folderPath },
          now,
        ),
      );
    }
    case 'project': {
      const project = await getProjectHeader(db, workspaceId, input.targetId);
      if (project === null) return 'gone';
      const reach = await loadProjectCollaborators(
        db,
        workspace,
        [{ id: project.id, folderPath: project.folderPath }],
        now,
      );
      return new Set(reach.get(project.id) ?? []);
    }
    case 'workspace':
      return new Set((await membersOf(db, workspaceId)).map((member) => member.userId));
    case 'invitation':
      return null;
  }
}

export async function generateNotifications(
  db: DirectDatabase,
  workspaceId: string,
  input: NotificationInput,
  options: { readonly newId?: () => string; readonly now?: () => Date } = {},
): Promise<string[]> {
  const now = options.now ?? (() => new Date());
  const audience = await audienceOf(db, workspaceId, input, now);
  if (audience === 'gone') return [];
  const excluded = new Set([input.actorId, ...(input.excludeIds ?? [])]);
  const candidates = input.recipientIds ?? (audience === null ? [] : [...audience]);
  const recipients = [...new Set(candidates)].filter(
    (userId) => !excluded.has(userId) && (audience === null || audience.has(userId)),
  );
  const newId = options.newId ?? newUlid;
  const groupKey = groupKeyOf(input);
  await insertNotifications(
    db,
    recipients.map((recipientId) => ({
      id: newId(),
      workspaceId,
      recipientId,
      actorId: input.actorId,
      event: input.event,
      targetType: input.targetType,
      targetId: input.targetId,
      groupKey,
      detail: input.detail ?? {},
      createdAt: now(),
    })),
  );
  return recipients;
}

/** The sink a request's context carries. */
export function notificationSink(
  db: DirectDatabase,
  workspaceId: string,
  options: { readonly newId?: () => string; readonly now?: () => Date } = {},
): NotificationSink {
  return async (input) => {
    try {
      await generateNotifications(db, workspaceId, input, options);
    } catch (error) {
      // Ids and the event name only: never content, never a URL.
      console.error('notification generation failed', {
        event: input.event,
        targetType: input.targetType,
        targetId: input.targetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
