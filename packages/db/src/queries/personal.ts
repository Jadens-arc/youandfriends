import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DirectDatabase } from '../client';
import type { Transaction } from '../transaction';
import { favorites } from '../schema/favorites';
import { folders } from '../schema/folders';
import { projects } from '../schema/projects';
import { recents } from '../schema/recents';
import { songs } from '../schema/songs';

/**
 * Per-person conveniences (task `044`): favourites and recents. No authorization here; the
 * callers in `apps/web/lib/library/personal.ts` decide visibility before and after.
 */

type TargetType = 'folder' | 'project' | 'song';

export async function setFavorite(
  db: DirectDatabase | Transaction,
  input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly targetType: TargetType;
    readonly targetId: string;
    readonly favorite: boolean;
  },
): Promise<void> {
  if (input.favorite) {
    await db
      .insert(favorites)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.workspaceId, input.workspaceId),
          eq(favorites.userId, input.userId),
          eq(favorites.targetType, input.targetType),
          eq(favorites.targetId, input.targetId),
        ),
      );
  }
}

/** A revisit inside this window is not written at all — the list's order would not change. */
export const RECENT_DEBOUNCE_SECONDS = 300;
/** How many of each kind one person keeps per workspace. */
export const RECENTS_CAP = 50;

/**
 * Record a view or a play. Returns whether anything was written.
 *
 * One statement for the common case: an upsert that moves the row forward only when it is older
 * than the debounce window, so refreshing a song page ten times writes once. Pruning runs only
 * when a row is *new* (`xmax = 0` on the returned row), which is the only time the count grows.
 */
export async function recordRecent(
  db: DirectDatabase,
  input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly kind: 'viewed' | 'played';
    readonly targetType: TargetType;
    readonly targetId: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const result = await db.execute<{ inserted: boolean }>(sql`
    insert into ${recents} (id, workspace_id, user_id, kind, target_type, target_id, occurred_at)
    values (${input.id}, ${input.workspaceId}, ${input.userId}, ${input.kind},
            ${input.targetType}, ${input.targetId}, ${input.now.toISOString()}::timestamptz)
    on conflict (workspace_id, user_id, kind, target_type, target_id) do update
       set occurred_at = excluded.occurred_at
     where ${recents.occurredAt} < excluded.occurred_at - make_interval(secs => ${RECENT_DEBOUNCE_SECONDS})
    returning (xmax = 0) as inserted
  `);
  const row = result.rows[0];
  if (row === undefined) return false;
  if (row.inserted) {
    await db.execute(sql`
      delete from ${recents}
       where workspace_id = ${input.workspaceId} and user_id = ${input.userId} and kind = ${input.kind}
         and id not in (
           select id from ${recents}
            where workspace_id = ${input.workspaceId} and user_id = ${input.userId}
              and kind = ${input.kind}
            order by occurred_at desc, id desc
            limit ${RECENTS_CAP})
    `);
  }
  return true;
}

export interface RecentRow {
  readonly targetType: 'project' | 'song';
  readonly targetId: string;
  readonly name: string;
  /** For a song, its project. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly folderPath: string;
  readonly occurredAt: Date;
}

/** One person's recents of one kind, newest first, live targets only, with their chains. */
export async function listRecents(
  db: Database,
  workspaceId: string,
  userId: string,
  kind: 'viewed' | 'played',
): Promise<RecentRow[]> {
  const targetSong = alias(songs, 'target_song');
  const targetProject = alias(projects, 'target_project');
  const songProject = alias(projects, 'song_project');
  const projectFolder = alias(folders, 'project_folder');

  const rows = await db
    .select({
      targetType: recents.targetType,
      targetId: recents.targetId,
      songTitle: targetSong.title,
      songProjectId: targetSong.projectId,
      songProjectName: songProject.name,
      projectName: targetProject.name,
      folderPath: sql<string>`coalesce(${projectFolder.path}, '')`,
      occurredAt: recents.occurredAt,
    })
    .from(recents)
    .leftJoin(
      targetSong,
      and(
        eq(recents.targetType, 'song'),
        eq(targetSong.id, recents.targetId),
        eq(targetSong.workspaceId, recents.workspaceId),
        sql`${targetSong.deletedAt} is null`,
      ),
    )
    .leftJoin(
      songProject,
      and(
        eq(songProject.id, targetSong.projectId),
        eq(songProject.workspaceId, recents.workspaceId),
        sql`${songProject.deletedAt} is null`,
      ),
    )
    .leftJoin(
      targetProject,
      and(
        eq(recents.targetType, 'project'),
        eq(targetProject.id, recents.targetId),
        eq(targetProject.workspaceId, recents.workspaceId),
        sql`${targetProject.deletedAt} is null`,
      ),
    )
    .leftJoin(
      projectFolder,
      and(
        eq(projectFolder.id, sql`coalesce(${targetProject.folderId}, ${songProject.folderId})`),
        eq(projectFolder.workspaceId, recents.workspaceId),
      ),
    )
    .where(
      and(eq(recents.workspaceId, workspaceId), eq(recents.userId, userId), eq(recents.kind, kind)),
    )
    .orderBy(desc(recents.occurredAt), desc(recents.id))
    .limit(RECENTS_CAP);

  const result: RecentRow[] = [];
  for (const row of rows) {
    if (row.targetType === 'song' && row.songTitle !== null && row.songProjectName !== null) {
      result.push({
        targetType: 'song',
        targetId: row.targetId,
        name: row.songTitle,
        projectId: row.songProjectId,
        projectName: row.songProjectName,
        folderPath: row.folderPath,
        occurredAt: row.occurredAt,
      });
    } else if (row.targetType === 'project' && row.projectName !== null) {
      result.push({
        targetType: 'project',
        targetId: row.targetId,
        name: row.projectName,
        projectId: null,
        projectName: null,
        folderPath: row.folderPath,
        occurredAt: row.occurredAt,
      });
    }
  }
  return result;
}
