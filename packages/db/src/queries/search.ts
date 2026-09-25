import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';

import type { Database } from '../client';
import { assets } from '../schema/assets';
import { folders } from '../schema/folders';
import { lyricsDocuments } from '../schema/lyrics';
import { projects } from '../schema/projects';
import { songs } from '../schema/songs';

/**
 * Workspace search (task `045`).
 *
 * **No authorization here**, as everywhere in this package — but search is where forgetting it
 * costs most, so the shape makes it hard to forget: {@link searchWorkspace} takes the ids the
 * caller has *already* decided this person may see, and every clause is bounded by them *inside
 * the query*. Rows outside that set are never matched, never counted, and never ranked, so
 * neither the results nor their number says anything about what else exists.
 *
 * The set comes from {@link listSearchScope} — ids and scope chains only, no names, titles, or
 * words — resolved through `packages/authz`.
 */

export interface SearchScopeRows {
  readonly projects: readonly { readonly id: string; readonly folderPath: string }[];
  readonly songs: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly folderPath: string;
  }[];
}

/** Every live project and song's id and scope chain in a workspace — the input to authz. */
export async function listSearchScope(db: Database, workspaceId: string): Promise<SearchScopeRows> {
  const folderPath = sql<string>`coalesce(${folders.path}, '')`;
  const liveProjects = await db
    .select({ id: projects.id, folderPath })
    .from(projects)
    .leftJoin(
      folders,
      and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
    )
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
  const liveSongs = await db
    .select({ id: songs.id, projectId: songs.projectId, folderPath })
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
    .where(and(eq(songs.workspaceId, workspaceId), isNull(songs.deletedAt)));
  return { projects: liveProjects, songs: liveSongs };
}

export interface SearchInput {
  readonly workspaceId: string;
  /** Projects this person may open. Nothing outside it is searched. */
  readonly projectIds: readonly string[];
  /** Songs this person may open. Nothing outside it is searched. */
  readonly songIds: readonly string[];
  /** What was typed, trimmed — for ordering by where it first appears. */
  readonly text: string;
  /** An `ILIKE` pattern with wildcards already escaped, e.g. `%long road%`. */
  readonly pattern: string;
  /** A `to_tsquery('simple', …)` expression of plain tokens, e.g. `long:* & road:*`; null skips lyrics. */
  readonly tsquery: string | null;
  readonly limit: number;
}

export interface SearchRows {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly songs: readonly {
    readonly id: string;
    readonly title: string;
    /** Null unless the project is in `projectIds` — a song shared alone keeps its project's name. */
    readonly projectName: string | null;
  }[];
  readonly files: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly songId: string | null;
    readonly songTitle: string | null;
    readonly projectId: string | null;
    readonly projectName: string | null;
  }[];
  readonly lyrics: readonly {
    readonly songId: string;
    readonly title: string;
    readonly projectName: string | null;
    /** A fragment around the match; matched words between U+0001 and U+0002. */
    readonly snippet: string;
  }[];
}

/** Characters a lyric can never contain (the contract forbids C0 controls), so safe markers. */
export const SNIPPET_START = '\u0001';
export const SNIPPET_STOP = '\u0002';

function within(column: AnyPgColumn, ids: readonly string[]): SQL {
  // An empty set matches nothing — never "no filter".
  return ids.length === 0 ? sql`false` : inArray(column, [...ids]);
}

/** The project around a row, joined only when it is one the person may open. */
const visibleProject = alias(projects, 'visible_project');

function joinVisibleProject(
  projectColumn: AnyPgColumn | SQL,
  workspaceId: string,
  ids: readonly string[],
) {
  return and(
    eq(visibleProject.id, projectColumn),
    eq(visibleProject.workspaceId, workspaceId),
    within(visibleProject.id, ids),
  );
}

export async function searchWorkspace(db: Database, input: SearchInput): Promise<SearchRows> {
  const { workspaceId, pattern, limit } = input;
  // Names that start with the query first, then those containing it early.
  const earliest = (column: AnyPgColumn) => sql`strpos(lower(${column}), lower(${input.text}))`;

  const [projectRows, songRows, fileRows, lyricRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
          within(projects.id, input.projectIds),
          sql`${projects.name} ilike ${pattern}`,
        ),
      )
      .orderBy(asc(earliest(projects.name)), asc(projects.name), asc(projects.id))
      .limit(limit),
    db
      .select({ id: songs.id, title: songs.title, projectName: visibleProject.name })
      .from(songs)
      .leftJoin(visibleProject, joinVisibleProject(songs.projectId, workspaceId, input.projectIds))
      .where(
        and(
          eq(songs.workspaceId, workspaceId),
          isNull(songs.deletedAt),
          within(songs.id, input.songIds),
          sql`${songs.title} ilike ${pattern}`,
        ),
      )
      .orderBy(asc(earliest(songs.title)), asc(songs.title), asc(songs.id))
      .limit(limit),
    db
      .select({
        id: assets.id,
        name: assets.name,
        kind: assets.kind,
        songId: assets.songId,
        songTitle: songs.title,
        projectId: assets.projectId,
        projectName: visibleProject.name,
      })
      .from(assets)
      .leftJoin(songs, and(eq(songs.id, assets.songId), eq(songs.workspaceId, assets.workspaceId)))
      .leftJoin(
        visibleProject,
        joinVisibleProject(
          sql`coalesce(${assets.projectId}, ${songs.projectId})`,
          workspaceId,
          input.projectIds,
        ),
      )
      .where(
        and(
          eq(assets.workspaceId, workspaceId),
          isNull(assets.deletedAt),
          // A song's file is as visible as the song; a project's own file as the project.
          or(
            within(assets.songId, input.songIds),
            and(isNull(assets.songId), within(assets.projectId, input.projectIds)),
          ),
          sql`${assets.name} ilike ${pattern}`,
          // A voice note is part of a comment, not a file (task `093`) — and an unposted one is
          // nobody's business but its maker's.
          ne(assets.kind, 'voice_note'),
        ),
      )
      .orderBy(desc(assets.updatedAt), asc(assets.id))
      .limit(limit),
    input.tsquery === null
      ? Promise.resolve([])
      : searchLyrics(db, workspaceId, input.songIds, input.projectIds, input.tsquery, limit),
  ]);
  return { projects: projectRows, songs: songRows, files: fileRows, lyrics: lyricRows };
}

async function searchLyrics(
  db: Database,
  workspaceId: string,
  songIds: readonly string[],
  projectIds: readonly string[],
  tsquery: string,
  limit: number,
) {
  const query = sql`to_tsquery('simple', ${tsquery})`;
  return db
    .select({
      songId: songs.id,
      title: songs.title,
      projectName: visibleProject.name,
      snippet: sql<string>`ts_headline('simple', ${lyricsDocuments.plainText}, ${query}, ${`StartSel=${SNIPPET_START}, StopSel=${SNIPPET_STOP}, MaxWords=14, MinWords=5, MaxFragments=1, FragmentDelimiter=" … "`})`,
    })
    .from(lyricsDocuments)
    .innerJoin(
      songs,
      and(eq(songs.id, lyricsDocuments.songId), eq(songs.workspaceId, lyricsDocuments.workspaceId)),
    )
    .leftJoin(visibleProject, joinVisibleProject(songs.projectId, workspaceId, projectIds))
    .where(
      and(
        eq(lyricsDocuments.workspaceId, workspaceId),
        isNull(songs.deletedAt),
        within(lyricsDocuments.songId, songIds),
        // The GIN-indexed generated column (task `080`), never a scan of the text.
        sql`${lyricsDocuments.search} @@ ${query}`,
      ),
    )
    .orderBy(desc(sql`ts_rank(${lyricsDocuments.search}, ${query})`), asc(songs.title))
    .limit(limit);
}
