import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../client';

/**
 * What a playback queue can hold (task `073`): mix versions whose streaming derivative is ready,
 * with the chain fields `packages/authz` needs to decide visibility in bulk.
 *
 * **No authorization here**, as everywhere in this package. The caller filters every row through
 * one `LibraryAccess` before anything reaches a queue; this only ever returns candidates from
 * the one workspace it is given.
 */
export interface PlayableVersionRow {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly songId: string;
  readonly title: string;
  readonly songArtist: string | null;
  readonly projectId: string;
  readonly projectArtist: string | null;
  readonly projectName: string;
  readonly folderPath: string;
}

export type PlayableSelection =
  /** Exactly these versions — a restored queue, re-authorized. Order is the caller's. */
  | { readonly kind: 'versions'; readonly versionIds: readonly string[] }
  /** Each song's current version, or its newest when none is chosen. */
  | { readonly kind: 'songs'; readonly songIds: readonly string[] }
  /** Every song in a project, in the project's own order. */
  | { readonly kind: 'project'; readonly projectId: string }
  /** Every song in every project beneath a folder, by project name then song order. */
  | { readonly kind: 'folder'; readonly folderPath: string };

type Row = {
  version_id: string;
  version_number: number;
  song_id: string;
  title: string;
  song_artist: string | null;
  project_id: string;
  project_artist: string | null;
  project_name: string;
  folder_path: string;
};

function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

export async function listPlayableVersions(
  db: Database,
  workspaceId: string,
  selection: PlayableSelection,
): Promise<PlayableVersionRow[]> {
  if (selection.kind === 'versions' && selection.versionIds.length === 0) return [];
  if (selection.kind === 'songs' && selection.songIds.length === 0) return [];

  const filter =
    selection.kind === 'versions'
      ? sql`mv.id in (${list(selection.versionIds)})`
      : selection.kind === 'songs'
        ? sql`s.id in (${list(selection.songIds)})`
        : selection.kind === 'project'
          ? sql`p.id = ${selection.projectId}`
          : // A folder's subtree: every project whose folder path starts with this one's.
            sql`f.path like ${`${selection.folderPath.replace(/[\\%_]/g, '\\$&')}%`}`;
  // Songs, projects and folders pick one version per song; a list of versions keeps each.
  const onePerSong = selection.kind !== 'versions';

  const result = await db.execute<Row>(sql`
    with playable as (
      select mv.id as version_id, mv.version_number, s.id as song_id, s.title,
             s.artist as song_artist, p.id as project_id, p.artist as project_artist,
             coalesce(f.path, '') as folder_path, p.name as project_name,
             s.created_at as song_created, (mv.id = s.current_version_id) as is_current
      from mix_versions mv
      join songs s
        on s.id = mv.song_id and s.workspace_id = mv.workspace_id and s.deleted_at is null
      join projects p
        on p.id = s.project_id and p.workspace_id = s.workspace_id and p.deleted_at is null
      left join folders f
        on f.id = p.folder_id and f.workspace_id = p.workspace_id and f.deleted_at is null
      where mv.workspace_id = ${workspaceId}
        and ${filter}
        and exists (
          select 1 from derivatives d
          where d.asset_version_id = mv.asset_version_id and d.workspace_id = mv.workspace_id
            and d.kind = 'streaming_audio' and d.processing_state = 'complete'
        )
    )
    ${
      onePerSong
        ? sql`select * from (
            select distinct on (song_id) * from playable
            order by song_id, is_current desc, version_number desc
          ) chosen order by project_name, song_created, song_id`
        : sql`select * from playable`
    }
  `);
  return result.rows.map((row) => ({
    versionId: row.version_id,
    versionNumber: Number(row.version_number),
    songId: row.song_id,
    title: row.title,
    songArtist: row.song_artist,
    projectId: row.project_id,
    projectArtist: row.project_artist,
    projectName: row.project_name,
    folderPath: row.folder_path,
  }));
}
