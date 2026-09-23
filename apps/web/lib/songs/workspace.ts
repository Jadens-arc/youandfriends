import { loadLibraryAccess, loadSongCollaborators, permits } from '@youandfriends/authz';
import {
  forbidden,
  isUlid,
  type AssetKind,
  type ProcessingState,
  type WorkStatus,
} from '@youandfriends/contracts';
import {
  favoritedTargets,
  getProjectHeader,
  getSongHeader,
  listMixVersions,
  listProjectSongs,
  listSongFiles,
  membersOf,
  type SongFileRow,
} from '@youandfriends/db';

import type { LibraryContext } from '@/lib/library/context';
import type { Collaborator } from '@/lib/library/projects';

/**
 * Use cases behind the song workspace (task `042`) and the project view it sits in.
 *
 * The song id is a URL segment, so it is attacker-controlled input: it is shape-checked, then
 * `assertCan(view)` runs before a single row about the song is read — a song in another
 * workspace, one never shared with this viewer, one in the trash, and one that never existed all
 * take the same 404-shaped refusal (`docs/THREAT_MODEL.md` T1).
 *
 * What crosses into the page is shaped for display: no folder paths (a path names every
 * ancestor, visible or not — task `040`'s finding), no storage keys, no asset ids for things the
 * viewer cannot open. A project the viewer cannot see is never named, the rule `SongSummary`
 * already follows in the library modules.
 */

export interface SongCapabilities {
  readonly comment: boolean;
  readonly edit: boolean;
  readonly download: boolean;
}

export interface SongVersion {
  readonly id: string;
  readonly number: number;
  readonly isCurrent: boolean;
  readonly note: string | null;
  readonly uploadedAt: Date;
  readonly uploaderName: string | null;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly durationMs: number | null;
  readonly codec: string | null;
  readonly channels: number | null;
  readonly sampleRateHz: number | null;
  readonly bitDepth: number | null;
  readonly integratedLufs: number | null;
  readonly truePeakDb: number | null;
  readonly processingState: ProcessingState;
  /** Only ever shown to someone who may edit the song — see {@link readSongWorkspace}. */
  readonly processingError: string | null;
}

/** The four fixed file groups (`docs/DESIGN.md` §4). */
export const FILE_GROUPS = ['masters', 'stems', 'project_files', 'artwork'] as const;
export type FileGroup = (typeof FILE_GROUPS)[number];

export interface SongFile {
  readonly id: string;
  readonly kind: AssetKind;
  readonly name: string;
  /** Where inside Project Files it is filed, e.g. `/Sessions/2026/`. `''` is the root. */
  readonly folderPath: string;
  readonly tags: readonly string[];
  readonly versionCount: number;
  readonly sizeBytes: number | null;
  readonly contentType: string | null;
  readonly uploadedAt: Date | null;
  readonly processingState: ProcessingState | null;
}

export type SongFileGroups = Readonly<Record<FileGroup, readonly SongFile[]>>;

export interface SiblingSong {
  readonly id: string;
  readonly title: string;
  readonly status: WorkStatus;
  readonly durationMs: number | null;
  readonly versionCount: number;
}

export interface SongWorkspace {
  readonly song: {
    readonly id: string;
    readonly title: string;
    readonly status: WorkStatus;
    readonly durationMs: number | null;
    readonly updatedAt: Date;
  };
  /** `null` when the song was shared on its own and its project is not open to this viewer. */
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly artist: string | null;
  } | null;
  /** The artist, even when the project itself is hidden: it is a fact about the song too. */
  readonly artist: string | null;
  readonly cover: null;
  readonly collaborators: readonly Collaborator[];
  readonly isFavorite: boolean;
  readonly capabilities: SongCapabilities;
  /** Newest first. */
  readonly versions: readonly SongVersion[];
  readonly currentVersionId: string | null;
  readonly files: SongFileGroups;
  /** The songs beside this one that the viewer can open, in tracklist order. */
  readonly siblings: readonly SiblingSong[];
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

export function groupOf(kind: AssetKind): FileGroup | null {
  switch (kind) {
    case 'master':
      return 'masters';
    case 'stem':
    case 'sample':
      return 'stems';
    case 'project_file':
      return 'project_files';
    case 'artwork':
      return 'artwork';
    case 'mix':
    case 'voice_note':
      return null;
  }
}

export function groupFiles(rows: readonly SongFileRow[]): SongFileGroups {
  const groups: Record<FileGroup, SongFile[]> = {
    masters: [],
    stems: [],
    project_files: [],
    artwork: [],
  };
  for (const row of rows) {
    const group = groupOf(row.kind);
    if (group === null) continue;
    groups[group].push({
      id: row.assetId,
      kind: row.kind,
      name: row.name,
      folderPath: row.folderPath,
      tags: row.tags,
      versionCount: row.versionCount,
      sizeBytes: row.latestSizeBytes,
      contentType: row.latestContentType,
      uploadedAt: row.latestUploadedAt,
      processingState: row.latestProcessingState,
    });
  }
  return groups;
}

/** Everything the song workspace shows, for this viewer, or a 404-shaped refusal. */
export async function readSongWorkspace(
  context: LibraryContext,
  songId: string,
): Promise<SongWorkspace> {
  if (!isUlid(songId)) refuse('song id is not a ULID');

  const target = { workspaceId: context.workspaceId, scopeType: 'song', scopeId: songId } as const;
  const access = await context.authz.resolveAccess(context.subject, target);
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);

  const header = await getSongHeader(context.db, context.workspaceId, songId);
  // Deleted between the check and the read, or its project is in the trash.
  if (header === null) refuse(`song ${songId} is not live`);

  const now = context.now ?? (() => new Date());
  const library = await loadLibraryAccess(context.db, context.subject, context.workspaceId, now);
  const projectVisible = library.project(header.projectId, header.folderPath) !== null;

  const [versionRows, fileRows, siblingRows, favorites, collaboratorIds, members] =
    await Promise.all([
      listMixVersions(context.db, context.workspaceId, songId),
      listSongFiles(context.db, context.workspaceId, {
        songId,
        projectId: header.projectId,
      }),
      listProjectSongs(context.db, context.workspaceId, header.projectId),
      favoritedTargets(context.db, context.workspaceId, context.userId, [songId]),
      loadSongCollaborators(
        context.db,
        context.workspaceId,
        { id: songId, projectId: header.projectId, folderPath: header.folderPath },
        now,
      ),
      membersOf(context.db, context.workspaceId),
    ]);

  const capabilities: SongCapabilities = {
    comment: permits(access, 'comment'),
    edit: permits(access, 'edit'),
    download: permits(access, 'download'),
  };

  const names = new Map(members.map((member) => [member.userId, member.displayName]));

  return {
    song: {
      id: header.id,
      title: header.title,
      status: header.status,
      durationMs: header.durationMs,
      updatedAt: header.updatedAt,
    },
    project: projectVisible
      ? { id: header.projectId, name: header.projectName, artist: header.artist }
      : null,
    artist: header.artist,
    cover: null,
    collaborators: collaboratorIds.flatMap((userId) => {
      const displayName = names.get(userId);
      return displayName === undefined ? [] : [{ userId, displayName }];
    }),
    isFavorite: favorites.has(songId),
    capabilities,
    versions: versionRows.map((row) => ({
      id: row.id,
      number: row.versionNumber,
      isCurrent: row.id === header.currentVersionId,
      note: row.note,
      uploadedAt: row.createdAt,
      uploaderName: row.uploaderName,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      durationMs: row.durationMs,
      codec: row.codec,
      channels: row.channels,
      sampleRateHz: row.sampleRateHz,
      bitDepth: row.bitDepth,
      integratedLufs: row.integratedLufs,
      truePeakDb: row.truePeakDb,
      processingState: row.processingState,
      // A pipeline error can name codecs, paths inside a temp directory, and tool output. The
      // viewer is told *that* it failed; the detail is for the people who can re-upload.
      processingError: capabilities.edit ? row.processingError : null,
    })),
    currentVersionId: header.currentVersionId,
    files: groupFiles(fileRows),
    siblings: siblingRows
      .filter((row) => library.song(row.id, header.projectId, header.folderPath) !== null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        durationMs: row.durationMs,
        versionCount: row.versionCount,
      })),
  };
}

export interface ProjectWorkspace {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly artist: string | null;
    readonly status: WorkStatus;
  };
  readonly cover: null;
  /** The folder it is filed in, when this viewer can see that folder — "Back" goes there. */
  readonly folder: { readonly id: string; readonly name: string } | null;
  readonly songs: readonly SiblingSong[];
}

/** A project and the songs in it this viewer can open, or a 404-shaped refusal. */
export async function readProjectWorkspace(
  context: LibraryContext,
  projectId: string,
): Promise<ProjectWorkspace> {
  if (!isUlid(projectId)) refuse('project id is not a ULID');

  await context.authz.assertCan(context.subject, 'view', {
    workspaceId: context.workspaceId,
    scopeType: 'project',
    scopeId: projectId,
  });

  const header = await getProjectHeader(context.db, context.workspaceId, projectId);
  if (header === null) refuse(`project ${projectId} is not live`);

  const now = context.now ?? (() => new Date());
  const [library, songRows] = await Promise.all([
    loadLibraryAccess(context.db, context.subject, context.workspaceId, now),
    listProjectSongs(context.db, context.workspaceId, projectId),
  ]);

  return {
    project: {
      id: header.id,
      name: header.name,
      artist: header.artist,
      status: header.status,
    },
    cover: null,
    folder:
      header.folderId !== null &&
      header.folderName !== null &&
      library.folder(header.folderPath) !== null
        ? { id: header.folderId, name: header.folderName }
        : null,
    songs: songRows
      .filter((row) => library.song(row.id, projectId, header.folderPath) !== null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        durationMs: row.durationMs,
        versionCount: row.versionCount,
      })),
  };
}
