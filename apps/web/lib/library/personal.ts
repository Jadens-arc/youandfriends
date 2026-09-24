import { loadLibraryAccess, type LibraryAccess } from '@youandfriends/authz';
import {
  forbidden,
  newUlid,
  type FavoriteRequest,
  type RecentRequest,
} from '@youandfriends/contracts';
import {
  listContentActivityPage,
  listFavoritesOf,
  listRecents,
  recordRecent,
  setFavorite,
  type RecentRow,
} from '@youandfriends/db';

import type { LibraryContext } from './context';
import {
  collectVisible,
  targetVisible,
  toActivityItem,
  visibleProjectId,
  type ActivityItem,
  type FavoriteItem,
} from './projects';

/**
 * Favourites, recents, and activity feeds (task `044`).
 *
 * All three are aggregation surfaces — one query returning rows about many different objects —
 * which is the single most likely place in the product for a cross-permission leak. So every
 * row is filtered through {@link LibraryAccess} against its *own* target, the same resolver the
 * library uses, never against workspace membership alone.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

async function assertMayView(
  context: LibraryContext,
  targetType: 'folder' | 'project' | 'song',
  targetId: string,
) {
  await context.authz.assertCan(context.subject, 'view', {
    workspaceId: context.workspaceId,
    scopeType: targetType,
    scopeId: targetId,
  });
}

/** Favourite or un-favourite something this person can see. Per person, never shared. */
export async function toggleFavorite(context: LibraryContext, request: FavoriteRequest) {
  await assertMayView(context, request.targetType, request.targetId);
  await setFavorite(context.db, {
    id: (context.newId ?? newUlid)(),
    workspaceId: context.workspaceId,
    userId: context.userId,
    targetType: request.targetType,
    targetId: request.targetId,
    favorite: request.favorite,
  });
}

/** Note that this person opened or played something. Debounced and capped in the query. */
export async function noteRecent(context: LibraryContext, request: RecentRequest) {
  if (
    !(await context.authz.can(context.subject, 'view', {
      workspaceId: context.workspaceId,
      scopeType: request.targetType,
      scopeId: request.targetId,
    }))
  ) {
    refuse(`may not view ${request.targetType} ${request.targetId}`);
  }
  await recordRecent(context.db, {
    id: (context.newId ?? newUlid)(),
    workspaceId: context.workspaceId,
    userId: context.userId,
    kind: request.kind,
    targetType: request.targetType,
    targetId: request.targetId,
    now: (context.now ?? (() => new Date()))(),
  });
}

async function accessFor(context: LibraryContext): Promise<LibraryAccess> {
  return loadLibraryAccess(context.db, context.subject, context.workspaceId, context.now);
}

/** Everything this person favourited that they can still open, newest first. */
export async function readFavorites(context: LibraryContext): Promise<FavoriteItem[]> {
  const access = await accessFor(context);
  const rows = await listFavoritesOf(context.db, context.workspaceId, context.userId, 200);
  return rows
    .filter((row) => targetVisible(access, row))
    .map((row) => ({
      targetType: row.targetType,
      targetId: row.targetId,
      name: row.name,
      projectId: visibleProjectId(access, row),
    }));
}

export interface RecentItem {
  readonly targetType: 'project' | 'song';
  readonly targetId: string;
  readonly name: string;
  /** For a song, its project — `null` unless this viewer can open that project. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly occurredAt: Date;
}

function recentVisible(access: LibraryAccess, row: RecentRow): boolean {
  return row.targetType === 'song'
    ? row.projectId !== null && access.song(row.targetId, row.projectId, row.folderPath) !== null
    : access.project(row.targetId, row.folderPath) !== null;
}

/** Recently viewed and recently played, each filtered by what this person can still open. */
export async function readRecents(
  context: LibraryContext,
): Promise<{ readonly viewed: readonly RecentItem[]; readonly played: readonly RecentItem[] }> {
  const access = await accessFor(context);
  const [viewed, played] = await Promise.all([
    listRecents(context.db, context.workspaceId, context.userId, 'viewed'),
    listRecents(context.db, context.workspaceId, context.userId, 'played'),
  ]);
  const shape = (row: RecentRow): RecentItem => {
    const projectId = visibleProjectId(access, row);
    return {
      targetType: row.targetType,
      targetId: row.targetId,
      name: row.name,
      projectId,
      projectName: projectId === null ? null : row.projectName,
      occurredAt: row.occurredAt,
    };
  };
  return {
    viewed: viewed.filter((row) => recentVisible(access, row)).map(shape),
    played: played.filter((row) => recentVisible(access, row)).map(shape),
  };
}

/**
 * An activity feed: everyone else's content changes across the workspace, or everything about
 * one song (including this person's own). Each event is kept only if its own target is visible
 * to this viewer — a collaborator on one song sees nothing about the songs beside it.
 */
export async function readActivity(
  context: LibraryContext,
  options: { readonly songId?: string; readonly limit?: number } = {},
): Promise<ActivityItem[]> {
  const access = await accessFor(context);
  const limit = options.limit ?? 30;
  const target =
    options.songId === undefined ? undefined : ({ type: 'song', id: options.songId } as const);
  const rows = await collectVisible(
    (after) =>
      listContentActivityPage(
        context.db,
        context.workspaceId,
        target === undefined ? context.userId : null,
        50,
        after,
        target,
      ),
    (row) => targetVisible(access, row),
    limit,
  );
  return rows.map((row) => toActivityItem(access, row));
}
