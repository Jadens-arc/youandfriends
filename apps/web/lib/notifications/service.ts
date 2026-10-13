import { loadLibraryAccess } from '@youandfriends/authz';
import { MENTION_PATTERN, isUlid, validationFailed } from '@youandfriends/contracts';
import {
  folders,
  listNotificationRows,
  markNotificationsRead,
  markNotificationsUnread,
  projects,
  songs,
  users,
  workspaceMemberships,
  type NotificationLink,
  type NotificationRow,
} from '@youandfriends/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Reading the notification center (task `095`).
 *
 * Every row is filtered by the reader's access **now**, with the same resolver the library uses:
 * a person who lost access to a song since a notification was written does not see it, nor its
 * preview. A target in the trash is not shown either. Nothing here can name a row of another
 * person or workspace — the recipient and workspace are part of every query.
 */

export interface NotificationItemView {
  readonly actor: string | null;
  readonly preview: string | null;
  readonly href: string;
  readonly at: string;
}

export interface NotificationView {
  readonly id: string;
  readonly event: string;
  readonly read: boolean;
  readonly count: number;
  readonly summary: string;
  readonly targetName: string;
  readonly href: string;
  readonly updatedAt: string;
  readonly items: readonly NotificationItemView[];
}

export interface NotificationsView {
  readonly notifications: readonly NotificationView[];
  readonly unread: number;
}

interface Reachable {
  readonly name: string;
}

/** The targets of these rows the reader may open now, by `type:id`. */
async function reachableTargets(
  context: LibraryContext,
  rows: readonly NotificationRow[],
): Promise<Map<string, Reachable>> {
  const reachable = new Map<string, Reachable>();
  const songIds = [...new Set(rows.filter((r) => r.targetType === 'song').map((r) => r.targetId))];
  const projectIds = [
    ...new Set(rows.filter((r) => r.targetType === 'project').map((r) => r.targetId)),
  ];
  const access = await loadLibraryAccess(
    context.db,
    context.subject,
    context.workspaceId,
    context.now ?? (() => new Date()),
  );
  const folderPath = sql<string>`coalesce(${folders.path}, '')`;
  if (songIds.length > 0) {
    const songRows = await context.db
      .select({
        id: songs.id,
        title: songs.title,
        projectId: projects.id,
        folderPath,
      })
      .from(songs)
      .innerJoin(
        projects,
        and(
          eq(projects.id, songs.projectId),
          eq(projects.workspaceId, songs.workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .leftJoin(
        folders,
        and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
      )
      .where(
        and(
          eq(songs.workspaceId, context.workspaceId),
          inArray(songs.id, songIds),
          isNull(songs.deletedAt),
        ),
      );
    for (const song of songRows) {
      if (access.song(song.id, song.projectId, song.folderPath) !== null) {
        reachable.set(`song:${song.id}`, { name: song.title });
      }
    }
  }
  if (projectIds.length > 0) {
    const projectRows = await context.db
      .select({ id: projects.id, name: projects.name, folderPath })
      .from(projects)
      .leftJoin(
        folders,
        and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
      )
      .where(
        and(
          eq(projects.workspaceId, context.workspaceId),
          inArray(projects.id, projectIds),
          isNull(projects.deletedAt),
        ),
      );
    for (const project of projectRows) {
      if (access.project(project.id, project.folderPath) !== null) {
        reachable.set(`project:${project.id}`, { name: project.name });
      }
    }
  }
  // The workspace: reading this at all required membership of it.
  reachable.set(`workspace:${context.workspaceId}`, { name: 'this workspace' });
  return reachable;
}

/** Where a notification about a target lands — the exact thread, version, or tab. */
export function hrefFor(
  targetType: 'song' | 'project' | 'workspace',
  targetId: string,
  link: NotificationLink | null,
): string {
  if (targetType === 'project') return `/projects/${encodeURIComponent(targetId)}`;
  if (targetType === 'workspace') return '/settings';
  const params = new URLSearchParams();
  const tab = link?.tab ?? (link?.threadId === undefined ? undefined : 'activity');
  if (tab !== undefined && tab !== 'overview') params.set('tab', tab);
  if (link?.versionId !== undefined) params.set('version', link.versionId);
  if (link?.threadId !== undefined) params.set('thread', link.threadId);
  const query = params.toString();
  return `/songs/${encodeURIComponent(targetId)}${query === '' ? '' : `?${query}`}`;
}

function summaryOf(row: NotificationRow, actor: string, target: string): string {
  const many = row.count > 1;
  switch (row.event) {
    case 'comment.created':
    case 'comment.replied':
    case 'voice_note.created':
      return many ? `${row.count} new comments on ${target}` : `${actor} commented on ${target}`;
    case 'comment.mentioned':
      return many
        ? `You were mentioned ${row.count} times on ${target}`
        : `${actor} mentioned you on ${target}`;
    case 'version.created':
      return many
        ? `${row.count} new uploads on ${target}`
        : `${actor} uploaded a new version of ${target}`;
    case 'version.processed':
      return `Your upload to ${target} is ready to play`;
    case 'version.processing_failed':
      return `Your upload to ${target} could not be processed`;
    case 'lyrics.changed':
      return `${actor} edited the lyrics of ${target}`;
    case 'metadata.changed':
      return `${actor} changed the details of ${target}`;
    case 'access.changed':
      return target === 'this workspace'
        ? `${actor} changed your access to this workspace`
        : `${actor} changed who can open ${target}`;
    case 'invitation.received':
      return `${actor} invited you to ${target}`;
    default:
      return `Something changed on ${target}`;
  }
}

/** Mention tokens in a preview, shown by the person's current name. */
function namePreview(preview: string | null, names: ReadonlyMap<string, string>): string | null {
  if (preview === null) return null;
  return preview.replace(MENTION_PATTERN, (_, id: string) => `@${names.get(id) ?? 'someone'}`);
}

/** Display names of these people — members of this workspace only. */
async function namesOf(context: LibraryContext, ids: readonly string[]) {
  const unique = [...new Set(ids)].filter(isUlid);
  if (unique.length === 0) return new Map<string, string>();
  const rows = await context.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.userId, users.id),
        eq(workspaceMemberships.workspaceId, context.workspaceId),
      ),
    )
    .where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listNotifications(
  context: LibraryContext,
  options: { readonly unreadOnly?: boolean } = {},
): Promise<NotificationsView> {
  const rows = await listNotificationRows(context.db, context.workspaceId, context.userId);
  const reachable = await reachableTargets(context, rows);
  const visible = rows.filter((row) => reachable.has(`${row.targetType}:${row.targetId}`));
  const mentioned = visible.flatMap((row) =>
    row.items.flatMap((item) => [
      ...(item.actorId === null ? [] : [item.actorId]),
      ...[...(item.preview ?? '').matchAll(MENTION_PATTERN)].map((match) => match[1] ?? ''),
    ]),
  );
  const names = await namesOf(context, mentioned);
  const unread = visible.filter((row) => row.readAt === null).length;
  const shown =
    options.unreadOnly === true ? visible.filter((row) => row.readAt === null) : visible;
  return {
    unread,
    notifications: shown.map((row) => {
      const target = reachable.get(`${row.targetType}:${row.targetId}`)?.name ?? '';
      const actor = (row.actorId === null ? null : names.get(row.actorId)) ?? 'Someone';
      const latest = row.items[0] ?? null;
      return {
        id: row.id,
        event: row.event,
        read: row.readAt !== null,
        count: row.count,
        summary: summaryOf(row, actor, target),
        targetName: target,
        href: hrefFor(row.targetType, row.targetId, latest?.link ?? null),
        updatedAt: row.updatedAt.toISOString(),
        items: row.items.map((item) => ({
          actor: item.actorId === null ? null : (names.get(item.actorId) ?? null),
          preview: namePreview(item.preview, names),
          href: hrefFor(row.targetType, row.targetId, item.link),
          at: item.at,
        })),
      };
    }),
  };
}

/** The unread count for the shell's indicator — after the same access filter as the list. */
export async function unreadCount(context: LibraryContext): Promise<number> {
  return (await listNotifications(context, { unreadOnly: true })).unread;
}

export async function setNotificationsRead(
  context: LibraryContext,
  input: { readonly ids?: readonly string[] | undefined; readonly all?: boolean | undefined },
  read: boolean,
): Promise<void> {
  const now = (context.now ?? (() => new Date()))();
  if (input.all === true) {
    if (!read)
      throw validationFailed([{ path: 'all', message: 'Only marking read applies to all.' }]);
    await markNotificationsRead(context.db, context.workspaceId, context.userId, 'all', now);
    return;
  }
  const ids = (input.ids ?? []).filter(isUlid);
  if (read) await markNotificationsRead(context.db, context.workspaceId, context.userId, ids, now);
  else await markNotificationsUnread(context.db, context.workspaceId, context.userId, ids);
}
