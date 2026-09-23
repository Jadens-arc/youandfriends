import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../client';
import { auditEvents } from '../schema/audit';
import { favorites } from '../schema/favorites';
import { folders } from '../schema/folders';
import { projects } from '../schema/projects';
import { songs } from '../schema/songs';
import { users } from '../schema/users';
import { workspaceMemberships } from '../schema/workspaces';

/**
 * The project library's reads (task `041`): the project list, and the rows behind the secondary
 * modules — recent songs, favourites, and collaborator activity.
 *
 * **No authorization here**, as everywhere in this package. Each function returns candidates
 * with enough of their scope chain attached (the owning folder's materialized path, and the
 * project for a song) that `packages/authz` can decide visibility for the whole set against one
 * load of the subject's grants. Nothing here is safe to hand to a route directly.
 *
 * Every aggregate a card shows — song count, last activity — is computed in the list query
 * itself. A per-card request is the N+1 the task notes warn about, and it shows up at the first
 * realistic library size.
 */

export interface ProjectListRow {
  readonly id: string;
  readonly name: string;
  readonly artist: string | null;
  readonly folderId: string | null;
  /** The owning folder's materialized path, `''` when unfiled — the input `buildChain` needs. */
  readonly folderPath: string;
  readonly coverAssetId: string | null;
  readonly status: (typeof projects.$inferSelect)['status'];
  readonly songCount: number;
  readonly createdAt: Date;
  /** The later of the project's own last change and its most recently changed live song. */
  readonly lastActivityAt: Date;
}

/**
 * Every live project in a workspace, with its song count and last activity.
 *
 * One statement: a grouped subquery over live songs joined back to the projects, so the cost is
 * one index scan per table regardless of how many cards the library will draw.
 *
 * `excludeSongIds` keeps songs out of both aggregates. It is how a card stays viewer-relative: a
 * song hidden from this viewer by a song-level deny must not be counted, and its edits must not
 * move the card's "last activity" — either would tell them the song exists (task `041`'s security
 * review). Deciding *which* ids is `packages/authz`'s job; this only honours the list.
 */
export async function listWorkspaceProjects(
  db: Database,
  workspaceId: string,
  excludeSongIds: readonly string[] = [],
): Promise<ProjectListRow[]> {
  const songStats = db
    .select({
      projectId: songs.projectId,
      songCount: sql<number>`count(*)::int`.as('song_count'),
      lastSongChangeAt: sql<Date>`max(${songs.updatedAt})`.as('last_song_change_at'),
    })
    .from(songs)
    .where(
      and(
        eq(songs.workspaceId, workspaceId),
        isNull(songs.deletedAt),
        excludeSongIds.length === 0 ? undefined : notInArray(songs.id, [...excludeSongIds]),
      ),
    )
    .groupBy(songs.projectId)
    .as('song_stats');

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      artist: projects.artist,
      folderId: projects.folderId,
      folderPath: sql<string>`coalesce(${folders.path}, '')`,
      coverAssetId: projects.coverAssetId,
      status: projects.status,
      songCount: sql<number>`coalesce(${songStats.songCount}, 0)::int`,
      createdAt: projects.createdAt,
      lastActivityAt: sql<Date>`greatest(${projects.updatedAt}, ${songStats.lastSongChangeAt})`,
    })
    .from(projects)
    // The folder's path is part of the project's scope chain whether or not the folder is
    // itself live, so this join does not filter on `folders.deleted_at`: dropping the path
    // would silently drop every grant made on that folder from the resolution.
    .leftJoin(
      folders,
      and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
    )
    .leftJoin(songStats, eq(songStats.projectId, projects.id))
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt), desc(projects.id));

  // `greatest` over a timestamptz column comes back from the driver as a string, not a Date,
  // because Drizzle cannot see through the SQL expression to the column's own mapping.
  return rows.map((row) => ({ ...row, lastActivityAt: new Date(row.lastActivityAt) }));
}

export interface SongListRow {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly folderPath: string;
  readonly durationMs: number | null;
  readonly updatedAt: Date;
}

/**
 * A keyset cursor over `(timestamp, id)`, both descending.
 *
 * `at` is Postgres's own text rendering of the timestamp, not a `Date`: a `Date` holds
 * milliseconds and the column holds microseconds, so a cursor round-tripped through one would
 * compare as earlier than the row it came from and skip every row sharing its millisecond.
 */
export interface RecencyCursor {
  readonly at: string;
  readonly id: string;
}

/**
 * One keyset page. `next` is null once the listing is exhausted; otherwise it is the cursor of
 * the page's last *scanned* row, which may be one this page did not return (a deleted target),
 * so a caller always advances past everything already read.
 */
export interface RecencyPage<T> {
  readonly items: readonly T[];
  readonly next: RecencyCursor | null;
}

/**
 * One page of a workspace's live songs, most recently changed first.
 *
 * Paged by keyset rather than taking "the newest N": the caller filters by visibility after the
 * fact, and a limited collaborator may be able to see none of the newest fifty — a fixed `LIMIT`
 * would silently hand them an empty module instead of the songs they can actually see further
 * down. See `apps/web/lib/library/projects.ts`'s `collectVisible`.
 */
export async function listRecentSongsPage(
  db: Database,
  workspaceId: string,
  pageSize: number,
  after: RecencyCursor | null,
): Promise<RecencyPage<SongListRow>> {
  const rows = await db
    .select({
      id: songs.id,
      title: songs.title,
      projectId: songs.projectId,
      projectName: projects.name,
      folderPath: sql<string>`coalesce(${folders.path}, '')`,
      durationMs: songs.durationMs,
      updatedAt: songs.updatedAt,
      cursorAt: sql<string>`${songs.updatedAt}::text`,
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
        eq(songs.workspaceId, workspaceId),
        isNull(songs.deletedAt),
        after === null
          ? undefined
          : or(
              sql`${songs.updatedAt} < ${after.at}::timestamptz`,
              and(sql`${songs.updatedAt} = ${after.at}::timestamptz`, lt(songs.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(songs.updatedAt), desc(songs.id))
    .limit(pageSize);

  const last = rows.at(-1);
  return {
    items: rows.map(({ cursorAt: _cursorAt, ...row }) => row),
    next: rows.length < pageSize || last === undefined ? null : { at: last.cursorAt, id: last.id },
  };
}

/** Specific live songs by id, with the same chain fields as {@link listRecentSongsPage}. */
export async function listSongsByIds(
  db: Database,
  workspaceId: string,
  songIds: readonly string[],
): Promise<SongListRow[]> {
  if (songIds.length === 0) return [];
  return db
    .select({
      id: songs.id,
      title: songs.title,
      projectId: songs.projectId,
      projectName: projects.name,
      folderPath: sql<string>`coalesce(${folders.path}, '')`,
      durationMs: songs.durationMs,
      updatedAt: songs.updatedAt,
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
        eq(songs.workspaceId, workspaceId),
        isNull(songs.deletedAt),
        inArray(songs.id, [...songIds]),
      ),
    )
    .orderBy(desc(songs.updatedAt), desc(songs.id));
}

export type FavoriteTargetType = (typeof favorites.$inferSelect)['targetType'];

export interface FavoriteRow {
  readonly targetType: FavoriteTargetType;
  readonly targetId: string;
  /** The folder's, project's, or song's own name. */
  readonly name: string;
  /** For a song, its project. Null for a folder or a project. */
  readonly projectId: string | null;
  /** The folder path the target's scope chain starts from — see {@link ProjectListRow}. */
  readonly folderPath: string;
  readonly createdAt: Date;
}

/**
 * One person's favourites in one workspace, newest first, with each target's name and chain.
 *
 * A favourite whose target has been deleted is dropped here rather than returned as a dangling
 * row: the polymorphic target has no foreign key (`schema/favorites.ts`), and a card for a
 * song that is in the trash is not a favourite anyone can open.
 */
export async function listFavoritesOf(
  db: Database,
  workspaceId: string,
  userId: string,
  limit: number,
): Promise<FavoriteRow[]> {
  const favoriteFolder = alias(folders, 'favorite_folder');
  const favoriteProject = alias(projects, 'favorite_project');
  const favoriteSong = alias(songs, 'favorite_song');
  const songProject = alias(projects, 'song_project');
  const projectFolder = alias(folders, 'project_folder');

  const rows = await db
    .select({
      targetType: favorites.targetType,
      targetId: favorites.targetId,
      folderName: favoriteFolder.name,
      folderPathOfFolder: favoriteFolder.path,
      projectName: favoriteProject.name,
      songTitle: favoriteSong.title,
      songProjectId: favoriteSong.projectId,
      projectFolderPath: projectFolder.path,
      createdAt: favorites.createdAt,
    })
    .from(favorites)
    .leftJoin(
      favoriteFolder,
      and(
        eq(favorites.targetType, 'folder'),
        eq(favoriteFolder.id, favorites.targetId),
        eq(favoriteFolder.workspaceId, favorites.workspaceId),
        isNull(favoriteFolder.deletedAt),
      ),
    )
    .leftJoin(
      favoriteProject,
      and(
        eq(favorites.targetType, 'project'),
        eq(favoriteProject.id, favorites.targetId),
        eq(favoriteProject.workspaceId, favorites.workspaceId),
        isNull(favoriteProject.deletedAt),
      ),
    )
    .leftJoin(
      favoriteSong,
      and(
        eq(favorites.targetType, 'song'),
        eq(favoriteSong.id, favorites.targetId),
        eq(favoriteSong.workspaceId, favorites.workspaceId),
        isNull(favoriteSong.deletedAt),
      ),
    )
    .leftJoin(
      songProject,
      and(
        eq(songProject.id, favoriteSong.projectId),
        eq(songProject.workspaceId, favorites.workspaceId),
        isNull(songProject.deletedAt),
      ),
    )
    // A project's folder, whether the favourite is the project itself or a song inside it.
    .leftJoin(
      projectFolder,
      and(
        eq(projectFolder.id, sql`coalesce(${favoriteProject.folderId}, ${songProject.folderId})`),
        eq(projectFolder.workspaceId, favorites.workspaceId),
      ),
    )
    .where(and(eq(favorites.workspaceId, workspaceId), eq(favorites.userId, userId)))
    .orderBy(desc(favorites.createdAt), desc(favorites.id))
    .limit(limit);

  const result: FavoriteRow[] = [];
  for (const row of rows) {
    if (row.targetType === 'folder' && row.folderName !== null) {
      result.push({
        targetType: 'folder',
        targetId: row.targetId,
        name: row.folderName,
        projectId: null,
        folderPath: row.folderPathOfFolder ?? '',
        createdAt: row.createdAt,
      });
    } else if (row.targetType === 'project' && row.projectName !== null) {
      result.push({
        targetType: 'project',
        targetId: row.targetId,
        name: row.projectName,
        projectId: null,
        folderPath: row.projectFolderPath ?? '',
        createdAt: row.createdAt,
      });
    } else if (row.targetType === 'song' && row.songTitle !== null && row.songProjectId !== null) {
      result.push({
        targetType: 'song',
        targetId: row.targetId,
        name: row.songTitle,
        projectId: row.songProjectId,
        folderPath: row.projectFolderPath ?? '',
        createdAt: row.createdAt,
      });
    }
  }
  return result;
}

/**
 * The audit actions that are *content* activity — someone changing the work itself — and so
 * may be shown to a collaborator who can see the target.
 *
 * An allow-list, never a deny-list. The audit log is an owner surface (`docs/DESIGN.md` §3,
 * "audit access"), and most of it is not activity anyone else should see: sign-ins, permission
 * changes, invitations, share-link access, downloads. A new action added to `AUDIT_ACTIONS`
 * stays out of every non-owner's view until someone decides, here, that it belongs.
 */
export const CONTENT_ACTIVITY_ACTIONS = [
  'project.updated',
  'song.updated',
  'folder.updated',
  'folder.moved',
  'lyrics.updated',
  'comment.created',
] as const;

export type ContentActivityAction = (typeof CONTENT_ACTIVITY_ACTIONS)[number];

export interface ActivityRow {
  readonly id: string;
  readonly action: ContentActivityAction;
  readonly actorId: string;
  readonly actorName: string;
  readonly targetType: 'folder' | 'project' | 'song';
  readonly targetId: string;
  readonly targetName: string;
  /** For a song, its project. Null otherwise. */
  readonly projectId: string | null;
  readonly folderPath: string;
  readonly occurredAt: Date;
}

/**
 * One page of content activity by *other* people, newest first, with each target's chain.
 *
 * Only actors who are still members, only live folder/project/song targets, only
 * {@link CONTENT_ACTIVITY_ACTIONS}, and never the viewer's own events — "collaborator
 * activity" is what the people you work with did. Keyset-paged for the same reason as
 * {@link listRecentSongsPage}: visibility is decided afterwards.
 *
 * Nothing from `metadata` is selected. It was redacted at write time, but it was written for
 * an owner reading the audit log, not for a collaborator's library.
 */
export async function listContentActivityPage(
  db: Database,
  workspaceId: string,
  excludeActorId: string,
  pageSize: number,
  after: RecencyCursor | null,
): Promise<RecencyPage<ActivityRow>> {
  const targetFolder = alias(folders, 'target_folder');
  const targetProject = alias(projects, 'target_project');
  const targetSong = alias(songs, 'target_song');
  const songProject = alias(projects, 'song_project');
  const projectFolder = alias(folders, 'project_folder');

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorId: auditEvents.actorId,
      actorName: users.displayName,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      folderName: targetFolder.name,
      folderPathOfFolder: targetFolder.path,
      projectName: targetProject.name,
      songTitle: targetSong.title,
      songProjectId: targetSong.projectId,
      projectFolderPath: projectFolder.path,
      occurredAt: auditEvents.occurredAt,
      cursorAt: sql<string>`${auditEvents.occurredAt}::text`,
    })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorId))
    // Current members only. Who *used* to work here is membership information too
    // (`docs/THREAT_MODEL.md`, asset 3), and a removed collaborator's name has no business
    // resurfacing in someone else's library.
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, auditEvents.workspaceId),
        eq(workspaceMemberships.userId, auditEvents.actorId),
      ),
    )
    .leftJoin(
      targetFolder,
      and(
        eq(auditEvents.targetType, 'folder'),
        eq(targetFolder.id, auditEvents.targetId),
        eq(targetFolder.workspaceId, auditEvents.workspaceId),
        isNull(targetFolder.deletedAt),
      ),
    )
    .leftJoin(
      targetProject,
      and(
        eq(auditEvents.targetType, 'project'),
        eq(targetProject.id, auditEvents.targetId),
        eq(targetProject.workspaceId, auditEvents.workspaceId),
        isNull(targetProject.deletedAt),
      ),
    )
    .leftJoin(
      targetSong,
      and(
        eq(auditEvents.targetType, 'song'),
        eq(targetSong.id, auditEvents.targetId),
        eq(targetSong.workspaceId, auditEvents.workspaceId),
        isNull(targetSong.deletedAt),
      ),
    )
    .leftJoin(
      songProject,
      and(
        eq(songProject.id, targetSong.projectId),
        eq(songProject.workspaceId, auditEvents.workspaceId),
        isNull(songProject.deletedAt),
      ),
    )
    .leftJoin(
      projectFolder,
      and(
        eq(projectFolder.id, sql`coalesce(${targetProject.folderId}, ${songProject.folderId})`),
        eq(projectFolder.workspaceId, auditEvents.workspaceId),
      ),
    )
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(auditEvents.actorKind, 'member'),
        sql`${auditEvents.actorId} <> ${excludeActorId}`,
        inArray(auditEvents.action, [...CONTENT_ACTIVITY_ACTIONS]),
        inArray(auditEvents.targetType, ['folder', 'project', 'song']),
        after === null
          ? undefined
          : or(
              sql`${auditEvents.occurredAt} < ${after.at}::timestamptz`,
              and(
                sql`${auditEvents.occurredAt} = ${after.at}::timestamptz`,
                lt(auditEvents.id, after.id),
              ),
            ),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(pageSize);

  const items: ActivityRow[] = [];
  for (const row of rows) {
    // Guaranteed by the `actor_kind = 'member'` filter and the inner join on `users`, and by the
    // target joins below matching at all; checked rather than asserted so the types say so.
    if (row.actorId === null || row.targetId === null) continue;
    const base = {
      id: row.id,
      action: row.action as ContentActivityAction,
      actorId: row.actorId,
      actorName: row.actorName,
      targetId: row.targetId,
      occurredAt: row.occurredAt,
    };
    if (row.targetType === 'folder' && row.folderName !== null) {
      items.push({
        ...base,
        targetType: 'folder',
        targetName: row.folderName,
        projectId: null,
        folderPath: row.folderPathOfFolder ?? '',
      });
    } else if (row.targetType === 'project' && row.projectName !== null) {
      items.push({
        ...base,
        targetType: 'project',
        targetName: row.projectName,
        projectId: null,
        folderPath: row.projectFolderPath ?? '',
      });
    } else if (row.targetType === 'song' && row.songTitle !== null && row.songProjectId !== null) {
      items.push({
        ...base,
        targetType: 'song',
        targetName: row.songTitle,
        projectId: row.songProjectId,
        folderPath: row.projectFolderPath ?? '',
      });
    }
    // Otherwise the target (or a song's project) has since been deleted: dropped, not shown.
  }

  const last = rows.at(-1);
  return {
    items,
    next: rows.length < pageSize || last === undefined ? null : { at: last.cursorAt, id: last.id },
  };
}
