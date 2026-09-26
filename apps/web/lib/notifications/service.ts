import { permits } from '@youandfriends/authz';
import {
  markNotificationsReadSchema,
  fieldErrorsFromZod,
  validationFailed,
  type NotificationEvent,
} from '@youandfriends/contracts';
import {
  comments,
  getProjectHeader,
  getSongHeader,
  invitations,
  markNotificationsRead,
  mixVersions,
  pruneNotifications,
  recentNotificationsFor,
  users,
  workspaces,
  type NotificationRow,
} from '@youandfriends/db';
import { and, eq, inArray } from 'drizzle-orm';

import { mentionsOf } from '@/lib/comments/mentions';
import { plainText } from '@/lib/comments/mention-format';
import type { LibraryContext } from '@/lib/library/context';
import { projectHref, songHref } from '@/lib/songs/routes';

/**
 * Reading notifications (task `095`).
 *
 * **Access is checked again here**, per target, on every read: a notification written while
 * someone could see a song is not shown once they cannot — revoked, denied, or the song trashed.
 * Comment previews are read from the comment itself, so a deleted comment's words are gone from
 * notifications too, and a mention in a deleted comment goes with it.
 *
 * Related notifications fold into one entry by their `group_key`: many comments on one song are
 * one line, "Sam and 2 others left 5 comments on Headlights", which opens to the list.
 */

export interface NotificationItemView {
  readonly id: string;
  readonly event: NotificationEvent;
  readonly summary: string;
  readonly preview: string | null;
  readonly href: string | null;
  readonly unread: boolean;
  readonly at: Date;
}

export interface NotificationGroupView {
  readonly key: string;
  readonly event: NotificationEvent;
  readonly summary: string;
  readonly preview: string | null;
  readonly href: string | null;
  readonly unread: boolean;
  readonly count: number;
  readonly latestAt: Date;
  /** Newest first. */
  readonly items: readonly NotificationItemView[];
}

export interface NotificationsView {
  readonly groups: readonly NotificationGroupView[];
  /** Unread entries (groups), after access filtering — what the badge shows. */
  readonly unread: number;
}

interface Target {
  readonly title: string;
}

const PREVIEW_CHARACTERS = 140;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARACTERS ? `${flat.slice(0, PREVIEW_CHARACTERS - 1)}…` : flat;
}

const targetKey = (row: Pick<NotificationRow, 'targetType' | 'targetId'>) =>
  `${row.targetType}:${row.targetId}`;

/** What each target is called — or null where this person may no longer see it. */
async function visibleTargets(
  context: LibraryContext,
  rows: readonly NotificationRow[],
  now: Date,
): Promise<Map<string, Target | null>> {
  const targets = new Map<string, Target | null>();
  const myEmail = rows.some((row) => row.targetType === 'invitation')
    ? (
        await context.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, context.userId))
      )[0]?.email
        .trim()
        .toLowerCase()
    : undefined;
  for (const row of rows) {
    const key = targetKey(row);
    if (targets.has(key)) continue;
    targets.set(key, await visibleTarget(context, row, now, myEmail));
  }
  return targets;
}

async function visibleTarget(
  context: LibraryContext,
  row: NotificationRow,
  now: Date,
  myEmail: string | undefined,
): Promise<Target | null> {
  switch (row.targetType) {
    case 'song': {
      if (row.workspaceId !== context.workspaceId) return null;
      const song = await getSongHeader(context.db, context.workspaceId, row.targetId);
      if (song === null) return null;
      const access = await context.authz.resolveAccess(context.subject, {
        workspaceId: context.workspaceId,
        scopeType: 'song',
        scopeId: row.targetId,
      });
      return permits(access, 'view') ? { title: song.title } : null;
    }
    case 'project': {
      if (row.workspaceId !== context.workspaceId) return null;
      const project = await getProjectHeader(context.db, context.workspaceId, row.targetId);
      if (project === null) return null;
      const access = await context.authz.resolveAccess(context.subject, {
        workspaceId: context.workspaceId,
        scopeType: 'project',
        scopeId: row.targetId,
      });
      return permits(access, 'view') ? { title: project.name } : null;
    }
    case 'workspace': {
      // Only the workspace being looked at; reaching this list at all needed its membership.
      if (row.targetId !== context.workspaceId) return null;
      const [workspace] = await context.db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, context.workspaceId));
      return workspace === undefined ? null : { title: workspace.name };
    }
    case 'invitation': {
      // Still pending, unexpired, and still addressed to this person's email.
      const [invitation] = await context.db
        .select({
          state: invitations.state,
          expiresAt: invitations.expiresAt,
          email: invitations.email,
          workspace: workspaces.name,
        })
        .from(invitations)
        .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
        .where(eq(invitations.id, row.targetId));
      if (
        invitation === undefined ||
        invitation.state !== 'pending' ||
        invitation.expiresAt <= now ||
        invitation.email !== myEmail
      ) {
        return null;
      }
      return { title: invitation.workspace };
    }
  }
}

interface CommentFacts {
  readonly preview: string | null;
  readonly deleted: boolean;
}

async function commentFacts(
  context: LibraryContext,
  rows: readonly NotificationRow[],
): Promise<Map<string, CommentFacts>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.workspaceId === context.workspaceId && row.detail.commentId !== undefined
          ? [row.detail.commentId]
          : [],
      ),
    ),
  ];
  const facts = new Map<string, CommentFacts>();
  if (ids.length === 0) return facts;
  const [found, mentions] = await Promise.all([
    context.db
      .select({
        id: comments.id,
        body: comments.body,
        tombstonedAt: comments.tombstonedAt,
        voiceNoteAssetId: comments.voiceNoteAssetId,
      })
      .from(comments)
      .where(and(eq(comments.workspaceId, context.workspaceId), inArray(comments.id, ids))),
    mentionsOf(context, ids),
  ]);
  for (const comment of found) {
    const deleted = comment.tombstonedAt !== null;
    const words = deleted ? '' : clip(plainText(comment.body, mentions.get(comment.id)));
    facts.set(comment.id, {
      deleted,
      preview: deleted
        ? null
        : words !== ''
          ? words
          : comment.voiceNoteAssetId === null
            ? null
            : 'Voice note',
    });
  }
  return facts;
}

async function namesOf(context: LibraryContext, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await context.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function mixNumbersOf(context: LibraryContext, rows: readonly NotificationRow[]) {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.workspaceId === context.workspaceId && row.detail.mixVersionId !== undefined
          ? [row.detail.mixVersionId]
          : [],
      ),
    ),
  ];
  if (ids.length === 0) return new Map<string, number>();
  const found = await context.db
    .select({ id: mixVersions.id, number: mixVersions.versionNumber })
    .from(mixVersions)
    .where(and(eq(mixVersions.workspaceId, context.workspaceId), inArray(mixVersions.id, ids)));
  return new Map(found.map((row) => [row.id, row.number]));
}

function hrefOf(row: NotificationRow): string | null {
  const { detail } = row;
  switch (row.targetType) {
    case 'song': {
      if (detail.commentId !== undefined) {
        return `${songHref(row.targetId, 'activity')}#comment-${detail.commentId}`;
      }
      if (row.event === 'lyrics.changed') return songHref(row.targetId, 'lyrics');
      if (detail.mixVersionId !== undefined) {
        return `${songHref(row.targetId)}?version=${encodeURIComponent(detail.mixVersionId)}`;
      }
      if (detail.assetVersionId !== undefined) return songHref(row.targetId, 'files');
      return songHref(row.targetId);
    }
    case 'project':
      return projectHref(row.targetId);
    case 'workspace':
      return '/';
    case 'invitation':
      // Accepting takes the link in the invitation itself; this carries no token.
      return null;
  }
}

function itemSummary(
  row: NotificationRow,
  actor: string,
  title: string,
  mixNumber: number | undefined,
): string {
  switch (row.event as NotificationEvent) {
    case 'comment.created':
      return `${actor} commented on ${title}`;
    case 'comment.replied':
      return `${actor} replied on ${title}`;
    case 'voice_note.created':
      return `${actor} left a voice note on ${title}`;
    case 'comment.mentioned':
      return `${actor} mentioned you on ${title}`;
    case 'version.created':
      return mixNumber === undefined
        ? `${actor} uploaded a new file to ${title}`
        : `${actor} uploaded version ${mixNumber} of ${title}`;
    case 'version.processed':
      return `Your upload to ${title} is ready to play`;
    case 'version.processing_failed':
      return `Your upload to ${title} couldn’t be processed`;
    case 'lyrics.changed':
      return `${actor} changed the lyrics of ${title}`;
    case 'metadata.changed':
      return `${actor} edited the details of ${title}`;
    case 'access.changed':
      return `${actor} changed your access in ${title}`;
    case 'invitation.received':
      return `${actor} invited you to ${title}`;
  }
}

function people(names: readonly string[]): string {
  const [first, second] = names;
  if (first === undefined) return 'Someone';
  if (second === undefined) return first;
  if (names.length === 2) return `${first} and ${second}`;
  return `${first} and ${names.length - 1} others`;
}

function groupSummary(
  event: NotificationEvent,
  items: readonly NotificationItemView[],
  actors: readonly string[],
  title: string,
): string {
  const first = items[0];
  if (items.length === 1 && first !== undefined) return first.summary;
  const who = people(actors);
  switch (event) {
    case 'comment.created':
    case 'comment.replied':
    case 'voice_note.created':
      return `${who} left ${items.length} comments on ${title}`;
    case 'version.created':
      return `${who} uploaded ${items.length} new versions and files to ${title}`;
    case 'lyrics.changed':
      return `${who} changed the lyrics of ${title}`;
    case 'metadata.changed':
      return `${who} edited the details of ${title}`;
    case 'access.changed':
      return `${who} changed your access in ${title}`;
    default:
      return first?.summary ?? title;
  }
}

export async function listNotifications(
  context: LibraryContext,
  options: { readonly unreadOnly?: boolean } = {},
): Promise<NotificationsView> {
  const now = (context.now ?? (() => new Date()))();
  // Retention runs as the list is read: nothing else needs to remember to.
  await pruneNotifications(context.db, context.userId, now);
  const rows = await recentNotificationsFor(context.db, context.workspaceId, context.userId);
  const [targets, facts, mixNumbers] = await Promise.all([
    visibleTargets(context, rows, now),
    commentFacts(context, rows),
    mixNumbersOf(context, rows),
  ]);
  const names = await namesOf(
    context,
    rows.flatMap((row) => (row.actorId === null ? [] : [row.actorId])),
  );

  const groups = new Map<
    string,
    { event: NotificationEvent; title: string; items: NotificationItemView[]; actors: string[] }
  >();
  for (const row of rows) {
    const target = targets.get(targetKey(row));
    if (target == null) continue;
    const comment =
      row.detail.commentId === undefined ? undefined : facts.get(row.detail.commentId);
    // A mention lives in the words: when they are gone, so is the mention.
    if (row.event === 'comment.mentioned' && (comment === undefined || comment.deleted)) continue;
    const actor = row.actorId === null ? 'Someone' : (names.get(row.actorId) ?? 'Someone');
    const event = row.event as NotificationEvent;
    const item: NotificationItemView = {
      id: row.id,
      event,
      summary: itemSummary(
        row,
        actor,
        target.title,
        row.detail.mixVersionId === undefined ? undefined : mixNumbers.get(row.detail.mixVersionId),
      ),
      preview:
        comment === undefined
          ? event === 'invitation.received'
            ? 'Open the link in your invitation to accept it.'
            : null
          : comment.deleted
            ? 'This comment was deleted.'
            : comment.preview,
      href: hrefOf(row),
      unread: row.readAt === null,
      at: row.createdAt,
    };
    const group = groups.get(row.groupKey) ?? {
      event,
      title: target.title,
      items: [],
      actors: [],
    };
    group.items.push(item);
    if (row.actorId !== null && !group.actors.includes(actor)) group.actors.push(actor);
    groups.set(row.groupKey, group);
  }

  const views: NotificationGroupView[] = [...groups].map(([key, group]) => {
    const latest = group.items[0] as NotificationItemView;
    return {
      key,
      event: group.event,
      summary: groupSummary(group.event, group.items, group.actors, group.title),
      preview: latest.preview,
      href: latest.href,
      unread: group.items.some((item) => item.unread),
      count: group.items.length,
      latestAt: latest.at,
      items: group.items,
    };
  });
  const unread = views.filter((view) => view.unread).length;
  return {
    groups: options.unreadOnly === true ? views.filter((view) => view.unread) : views,
    unread,
  };
}

export async function markRead(context: LibraryContext, input: unknown): Promise<number> {
  const parsed = markNotificationsReadSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const now = (context.now ?? (() => new Date()))();
  return markNotificationsRead(
    context.db,
    context.workspaceId,
    context.userId,
    'all' in parsed.data ? 'all' : parsed.data.ids,
    now,
  );
}
