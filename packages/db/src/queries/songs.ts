import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { assets } from '../schema/assets';
import { favorites } from '../schema/favorites';
import { folders } from '../schema/folders';
import { projects } from '../schema/projects';
import { songs } from '../schema/songs';
import { storageObjects } from '../schema/storage-objects';
import { users } from '../schema/users';
import { assetVersions, mixVersions } from '../schema/versions';

/**
 * The song workspace's reads (task `042`): one song's header, its version stack, its files, and
 * the songs beside it in its project.
 *
 * **No authorization here**, as everywhere in this package. Every row carries the chain fields
 * (`projectId`, `folderPath`) `packages/authz` needs, and the caller in `apps/web/lib/songs`
 * decides what the viewer may see before anything reaches a page. Every query is also scoped by
 * `workspace_id`, because the song id arrives from a URL and is attacker-controlled
 * (`docs/THREAT_MODEL.md` T1): a foreign id matches nothing, never another tenant's row.
 */

type WorkStatusValue = (typeof songs.$inferSelect)['status'];
type AssetKindValue = (typeof assets.$inferSelect)['kind'];
type ProcessingStateValue = (typeof assetVersions.$inferSelect)['processingState'];

export interface SongHeaderRow {
  readonly id: string;
  readonly title: string;
  readonly status: WorkStatusValue;
  /** The song's own artist, `null` to use the project's. */
  readonly songArtist: string | null;
  readonly notes: string | null;
  readonly durationMs: number | null;
  readonly currentVersionId: string | null;
  readonly updatedAt: Date;
  readonly projectId: string;
  readonly projectName: string;
  readonly artist: string | null;
  readonly coverAssetId: string | null;
  /** The owning project's folder path, `''` when unfiled — the input `buildChain` needs. */
  readonly folderPath: string;
}

/** One live song and its live project, or `null` for a missing, deleted, or foreign id. */
export async function getSongHeader(
  db: Database,
  workspaceId: string,
  songId: string,
): Promise<SongHeaderRow | null> {
  const [row] = await db
    .select({
      id: songs.id,
      title: songs.title,
      status: songs.status,
      songArtist: songs.artist,
      notes: songs.notes,
      durationMs: songs.durationMs,
      currentVersionId: songs.currentVersionId,
      updatedAt: songs.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      artist: projects.artist,
      coverAssetId: projects.coverAssetId,
      folderPath: sql<string>`coalesce(${folders.path}, '')`,
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
    // Not filtered on the folder's own `deleted_at`, for the reason `listWorkspaceProjects`
    // gives: the path is part of the chain, and dropping it drops every grant made on it.
    .leftJoin(
      folders,
      and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
    )
    .where(and(eq(songs.id, songId), eq(songs.workspaceId, workspaceId), isNull(songs.deletedAt)));

  return row ?? null;
}

export interface ProjectHeaderRow {
  readonly id: string;
  readonly name: string;
  readonly artist: string | null;
  readonly status: WorkStatusValue;
  readonly coverAssetId: string | null;
  readonly folderId: string | null;
  readonly folderName: string | null;
  readonly folderPath: string;
  readonly updatedAt: Date;
}

/** One live project, or `null` for a missing, deleted, or foreign id. */
export async function getProjectHeader(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<ProjectHeaderRow | null> {
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      artist: projects.artist,
      status: projects.status,
      coverAssetId: projects.coverAssetId,
      folderId: projects.folderId,
      folderName: folders.name,
      folderPath: sql<string>`coalesce(${folders.path}, '')`,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(
      folders,
      and(eq(folders.id, projects.folderId), eq(folders.workspaceId, projects.workspaceId)),
    )
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
      ),
    );

  return row ?? null;
}

export interface ProjectSongRow {
  readonly id: string;
  readonly title: string;
  readonly status: WorkStatusValue;
  readonly durationMs: number | null;
  readonly updatedAt: Date;
  /** How many mix versions the song has. Zero means nothing has been uploaded yet. */
  readonly versionCount: number;
}

/**
 * Every live song in a project, in creation order — the order a tracklist is written in, and
 * one that does not reshuffle the list under the pointer every time somebody saves.
 */
export async function listProjectSongs(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<ProjectSongRow[]> {
  const versionCounts = db
    .select({
      songId: mixVersions.songId,
      versionCount: sql<number>`count(*)::int`.as('version_count'),
    })
    .from(mixVersions)
    .where(eq(mixVersions.workspaceId, workspaceId))
    .groupBy(mixVersions.songId)
    .as('version_counts');

  return db
    .select({
      id: songs.id,
      title: songs.title,
      status: songs.status,
      durationMs: songs.durationMs,
      updatedAt: songs.updatedAt,
      versionCount: sql<number>`coalesce(${versionCounts.versionCount}, 0)::int`,
    })
    .from(songs)
    .leftJoin(versionCounts, eq(versionCounts.songId, songs.id))
    .where(
      and(
        eq(songs.workspaceId, workspaceId),
        eq(songs.projectId, projectId),
        isNull(songs.deletedAt),
      ),
    )
    .orderBy(asc(songs.createdAt), asc(songs.id));
}

export interface MixVersionRow {
  readonly id: string;
  readonly versionNumber: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly uploadedBy: string | null;
  readonly uploaderName: string | null;
  readonly assetVersionId: string;
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
  readonly loudnessRangeLu: number | null;
  readonly loudnessUnavailable: string | null;
  readonly processingState: ProcessingStateValue;
  readonly processingError: string | null;
}

/** A song's mix versions, newest first — the order the version selector reads in. */
export async function listMixVersions(
  db: Database,
  workspaceId: string,
  songId: string,
): Promise<MixVersionRow[]> {
  return db
    .select({
      id: mixVersions.id,
      versionNumber: mixVersions.versionNumber,
      note: mixVersions.note,
      createdAt: mixVersions.createdAt,
      uploadedBy: mixVersions.uploadedBy,
      uploaderName: users.displayName,
      assetVersionId: assetVersions.id,
      fileName: sql<string>`coalesce(${assetVersions.originalFilename}, ${assets.name})`,
      contentType: storageObjects.contentType,
      sizeBytes: storageObjects.sizeBytes,
      durationMs: assetVersions.durationMs,
      codec: assetVersions.codec,
      channels: assetVersions.channels,
      sampleRateHz: assetVersions.sampleRateHz,
      bitDepth: assetVersions.bitDepth,
      integratedLufs: assetVersions.integratedLufs,
      truePeakDb: assetVersions.truePeakDb,
      loudnessRangeLu: assetVersions.loudnessRangeLu,
      loudnessUnavailable: assetVersions.loudnessUnavailable,
      processingState: assetVersions.processingState,
      processingError: assetVersions.processingError,
    })
    .from(mixVersions)
    .innerJoin(
      assetVersions,
      and(
        eq(assetVersions.id, mixVersions.assetVersionId),
        eq(assetVersions.workspaceId, mixVersions.workspaceId),
      ),
    )
    .innerJoin(
      assets,
      and(eq(assets.id, assetVersions.assetId), eq(assets.workspaceId, assetVersions.workspaceId)),
    )
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, assetVersions.storageObjectId),
        eq(storageObjects.workspaceId, assetVersions.workspaceId),
      ),
    )
    .leftJoin(users, eq(users.id, mixVersions.uploadedBy))
    .where(and(eq(mixVersions.workspaceId, workspaceId), eq(mixVersions.songId, songId)))
    .orderBy(desc(mixVersions.versionNumber));
}

export interface SongFileRow {
  readonly assetId: string;
  readonly kind: AssetKindValue;
  readonly name: string;
  readonly folderPath: string;
  readonly tags: readonly string[];
  /** Whether the asset hangs off the song or off its project (artwork, shared project files). */
  readonly owner: 'song' | 'project';
  readonly versionCount: number;
  /** The newest version's facts. Null only for an asset whose first upload never finished. */
  readonly latestVersionId: string | null;
  readonly latestSizeBytes: number | null;
  readonly latestContentType: string | null;
  readonly latestUploadedAt: Date | null;
  readonly latestUploaderName: string | null;
  readonly latestProcessingState: ProcessingStateValue | null;
  readonly updatedAt: Date;
}

/**
 * The files the Files tab lists: the song's own live assets, and its project's.
 *
 * Mixes are left out — they are the version stack, shown by the selector, and listing them
 * twice would present one upload as two files. Voice notes are left out too: they belong to the
 * comment that references them (`docs/ARCHITECTURE.md` §4), not to a file group.
 */
export async function listSongFiles(
  db: Database,
  workspaceId: string,
  target: { readonly songId: string; readonly projectId: string },
): Promise<SongFileRow[]> {
  const latest = db
    .selectDistinctOn([assetVersions.assetId], {
      assetId: assetVersions.assetId,
      versionId: assetVersions.id,
      processingState: assetVersions.processingState,
      uploadedAt: assetVersions.createdAt,
      uploaderName: users.displayName,
      sizeBytes: storageObjects.sizeBytes,
      contentType: storageObjects.contentType,
      versionCount: sql<number>`count(*) over (partition by ${assetVersions.assetId})::int`.as(
        'version_count',
      ),
    })
    .from(assetVersions)
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, assetVersions.storageObjectId),
        eq(storageObjects.workspaceId, assetVersions.workspaceId),
      ),
    )
    .leftJoin(users, eq(users.id, assetVersions.uploadedBy))
    .where(eq(assetVersions.workspaceId, workspaceId))
    .orderBy(assetVersions.assetId, desc(assetVersions.versionNumber))
    .as('latest');

  const rows = await db
    .select({
      assetId: assets.id,
      kind: assets.kind,
      name: assets.name,
      folderPath: assets.folderPath,
      tags: assets.tags,
      songId: assets.songId,
      versionCount: sql<number>`coalesce(${latest.versionCount}, 0)::int`,
      latestVersionId: latest.versionId,
      latestSizeBytes: latest.sizeBytes,
      latestContentType: latest.contentType,
      latestUploadedAt: latest.uploadedAt,
      latestUploaderName: latest.uploaderName,
      latestProcessingState: latest.processingState,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .leftJoin(latest, eq(latest.assetId, assets.id))
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        isNull(assets.deletedAt),
        or(eq(assets.songId, target.songId), eq(assets.projectId, target.projectId)),
        ne(assets.kind, 'mix'),
        ne(assets.kind, 'voice_note'),
      ),
    )
    .orderBy(asc(assets.folderPath), asc(assets.name), asc(assets.id));

  return rows.map(({ songId, ...row }) => ({
    ...row,
    owner: songId === null ? 'project' : 'song',
    // A windowed timestamp through a subquery arrives as text for the same reason as
    // `listWorkspaceProjects`'s `greatest`.
    latestUploadedAt: row.latestUploadedAt === null ? null : new Date(row.latestUploadedAt),
  }));
}

/** Which of these targets this person has favourited in this workspace. */
export async function favoritedTargets(
  db: Database,
  workspaceId: string,
  userId: string,
  targetIds: readonly string[],
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const rows = await db
    .select({ targetId: favorites.targetId })
    .from(favorites)
    .where(
      and(
        eq(favorites.workspaceId, workspaceId),
        eq(favorites.userId, userId),
        inArray(favorites.targetId, [...targetIds]),
      ),
    );
  return new Set(rows.map((row) => row.targetId));
}

export interface WorkspaceSongRow {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
}

/**
 * Every live song in a workspace whose project is live too — candidates only, for `authz` to
 * filter (task `055`'s upload destinations). Ordered for a picker: by project, then tracklist.
 */
export async function listWorkspaceSongs(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceSongRow[]> {
  return db
    .select({ id: songs.id, title: songs.title, projectId: songs.projectId })
    .from(songs)
    .innerJoin(
      projects,
      and(
        eq(projects.id, songs.projectId),
        eq(projects.workspaceId, songs.workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .where(and(eq(songs.workspaceId, workspaceId), isNull(songs.deletedAt)))
    .orderBy(asc(projects.name), asc(songs.createdAt), asc(songs.id));
}
