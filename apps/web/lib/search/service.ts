import { loadLibraryAccess } from '@youandfriends/authz';
import type { AssetKind } from '@youandfriends/contracts';
import { listSearchScope, searchWorkspace, SNIPPET_START, SNIPPET_STOP } from '@youandfriends/db';

import type { LibraryContext } from '@/lib/library/context';
import { readRecents } from '@/lib/library/personal';
import { projectHref, songHref } from '@/lib/songs/routes';

import { parseSearch, snippetRuns } from './query';

/**
 * Workspace search (task `045`): projects, songs, files, and lyrics — only ever among what this
 * person may open.
 *
 * Visibility is decided first, from ids and scope chains alone, by the same resolver the library
 * uses (`loadLibraryAccess`); the search query then runs bounded by those ids, so a song someone
 * cannot open is never matched, counted, or ranked. That first step costs the same whatever was
 * typed, so the time a search takes says nothing about what a hidden song contains.
 */

export const SEARCH_LIMIT = 6;

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  /** Where it lives, as the viewer may know it: a project name, a song title — or nothing. */
  readonly detail: string | null;
  readonly href: string;
}

export interface LyricsHit extends SearchHit {
  readonly snippet: readonly { readonly text: string; readonly match: boolean }[];
}

export interface SearchResults {
  readonly query: string;
  readonly projects: readonly SearchHit[];
  readonly songs: readonly SearchHit[];
  readonly lyrics: readonly LyricsHit[];
  readonly files: readonly SearchHit[];
  /** With an empty query: what this person opened lately. */
  readonly recent: readonly SearchHit[];
}

const FILE_KINDS: Readonly<Record<AssetKind, string>> = {
  master: 'Master',
  mix: 'Mix',
  stem: 'Stem',
  sample: 'Sample',
  project_file: 'Project file',
  artwork: 'Artwork',
  voice_note: 'Voice note',
};

export async function search(context: LibraryContext, raw: string): Promise<SearchResults> {
  const parsed = parseSearch(raw);
  if (parsed === null) {
    const { viewed } = await readRecents(context);
    return {
      query: '',
      projects: [],
      songs: [],
      lyrics: [],
      files: [],
      recent: viewed.slice(0, SEARCH_LIMIT).map((item) => ({
        id: item.targetId,
        title: item.name,
        detail: item.targetType === 'song' ? item.projectName : 'Project',
        href: item.targetType === 'song' ? songHref(item.targetId) : projectHref(item.targetId),
      })),
    };
  }

  const now = context.now ?? (() => new Date());
  const [access, scope] = await Promise.all([
    loadLibraryAccess(context.db, context.subject, context.workspaceId, now),
    listSearchScope(context.db, context.workspaceId),
  ]);
  const projectIds = scope.projects
    .filter((project) => access.project(project.id, project.folderPath) !== null)
    .map((project) => project.id);
  const songIds = scope.songs
    .filter((song) => access.song(song.id, song.projectId, song.folderPath) !== null)
    .map((song) => song.id);

  const rows = await searchWorkspace(context.db, {
    workspaceId: context.workspaceId,
    projectIds,
    songIds,
    text: parsed.text,
    pattern: parsed.pattern,
    tsquery: parsed.tsquery,
    limit: SEARCH_LIMIT,
  });

  return {
    query: parsed.text,
    projects: rows.projects.map((row) => ({
      id: row.id,
      title: row.name,
      detail: 'Project',
      href: projectHref(row.id),
    })),
    songs: rows.songs.map((row) => ({
      id: row.id,
      title: row.title,
      detail: row.projectName,
      href: songHref(row.id),
    })),
    lyrics: rows.lyrics.map((row) => ({
      id: row.songId,
      title: row.title,
      detail: row.projectName,
      href: songHref(row.songId, 'lyrics'),
      snippet: snippetRuns(row.snippet, SNIPPET_START, SNIPPET_STOP),
    })),
    files: rows.files.map((row) => {
      const kind = FILE_KINDS[row.kind as AssetKind] ?? 'File';
      const where = row.songId !== null ? row.songTitle : row.projectName;
      return {
        id: row.id,
        title: row.name,
        detail: where === null ? kind : `${kind} · ${where}`,
        href:
          row.songId !== null
            ? songHref(row.songId, 'files')
            : row.projectId !== null
              ? projectHref(row.projectId)
              : '/library',
      };
    }),
    recent: [],
  };
}
