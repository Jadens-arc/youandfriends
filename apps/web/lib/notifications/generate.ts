import { loadProjectCollaborators, loadSongCollaborators } from '@youandfriends/authz';
import { newUlid, resolvePreferences, type WorkspaceId } from '@youandfriends/contracts';
import {
  emailModesOf,
  getProjectHeader,
  getSongHeader,
  insertNotifications,
  membersOf,
  preferencesOf,
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
 * - **Preferences** (task `096`): a row is written for in-app, for email, or both, as the reader
 *   chose — nothing if neither. Email is marked only when it can actually be sent.
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

export interface GenerateOptions {
  readonly newId?: () => string;
  readonly now?: () => Date;
  /** Whether email can be sent at all, and how immediate email is handed on (task `096`). */
  readonly email?: {
    readonly available: boolean;
    readonly dispatch: (notificationIds: readonly string[]) => Promise<void>;
  };
}

export async function generateNotifications(
  db: DirectDatabase,
  workspaceId: string,
  input: NotificationInput,
  options: GenerateOptions = {},
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
  const emailing = options.email?.available === true;
  const [saved, modes] = await Promise.all([
    preferencesOf(db, recipients),
    emailing ? emailModesOf(db, recipients) : Promise.resolve(new Map<string, string>()),
  ]);
  const rows = recipients.flatMap((recipientId) => {
    const wants = resolvePreferences(saved.filter((row) => row.userId === recipientId))[
      input.event
    ];
    const email = emailing && wants.email;
    if (!wants.in_app && !email) return [];
    return [
      {
        id: newId(),
        workspaceId,
        recipientId,
        actorId: input.actorId,
        event: input.event,
        targetType: input.targetType,
        targetId: input.targetId,
        groupKey,
        detail: input.detail ?? {},
        inApp: wants.in_app,
        emailStatus: email ? ('pending' as const) : null,
        createdAt: now(),
      },
    ];
  });
  await insertNotifications(db, rows);
  const immediate = rows.filter(
    (row) =>
      row.emailStatus === 'pending' && (modes.get(row.recipientId) ?? 'immediate') === 'immediate',
  );
  if (immediate.length > 0) await options.email?.dispatch(immediate.map((row) => row.id));
  return rows.map((row) => row.recipientId);
}

/** The sink a request's context carries. */
export function notificationSink(
  db: DirectDatabase,
  workspaceId: string,
  options: GenerateOptions = {},
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
