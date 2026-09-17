import { and, eq, inArray, isNull, isNotNull, like, or, sql, type SQL } from 'drizzle-orm';

import { assets, folders, projects, snapshots, songs } from './schema/index';
import type { Transaction } from './transaction';

/**
 * Soft deletion, restoration, and the cascade rules between them.
 *
 * Trash is a real place. Deleting marks a row and records when it may be destroyed;
 * restoring returns **exactly** what that delete removed, and nothing else.
 *
 * The cascade is stated here rather than left to foreign keys on purpose: ad hoc cascade is
 * where data loss hides. `ON DELETE CASCADE` is right for a hard delete — it keeps the
 * database consistent — but a soft delete needs to remember what it touched so the inverse
 * can undo precisely that.
 */

/** What a delete or restore actually touched, per table. */
export interface CascadeResult {
  readonly batch: string;
  readonly folders: string[];
  readonly projects: string[];
  readonly songs: string[];
  /** Project Files entries — stems, sessions, artwork, anything uploaded. */
  readonly assets: string[];
  /** Folder snapshots, which hang off a project. */
  readonly snapshots: string[];
}

/** Every table the cascade reaches. */
type Cascaded = typeof folders | typeof projects | typeof songs | typeof assets | typeof snapshots;

/** Every list empty, so each cascade states only the tables it actually reaches. */
const EMPTY_CASCADE = (): Omit<CascadeResult, 'batch'> => ({
  folders: [],
  projects: [],
  songs: [],
  assets: [],
  snapshots: [],
});

const empty = (batch: string): CascadeResult => ({ batch, ...EMPTY_CASCADE() });

export interface SoftDeleteOptions {
  readonly workspaceId: string;
  /** Who is doing it. Recorded on every row the cascade reaches. */
  readonly deletedBy: string | null;
  /** Groups this operation, so restore can be its exact inverse. */
  readonly batch: string;
  readonly now: Date;
  /** Days before a deleted row becomes purgeable. Recorded now, not computed at purge time. */
  readonly recoveryWindowDays: number;
}

const live = (table: Cascaded): SQL => isNull(table.deletedAt) as SQL;

/** `purge_after`, fixed at delete time. See the column's own comment for why. */
export function purgeAfterFrom(now: Date, recoveryWindowDays: number): Date {
  const after = new Date(now);
  after.setUTCDate(after.getUTCDate() + recoveryWindowDays);
  return after;
}

function tombstone(options: SoftDeleteOptions) {
  return {
    deletedAt: options.now,
    deletedBy: options.deletedBy,
    purgeAfter: purgeAfterFrom(options.now, options.recoveryWindowDays),
    deletedBatch: options.batch,
  };
}

/**
 * Soft-delete a song, and the assets hanging off it.
 *
 * Not the leaf case. A song's stems, sessions, and bounces are `assets` with `song_id` set, and
 * leaving them live when the song is trashed means they stay visible through `scopedQuery`,
 * stay reachable by a download, and never come back symmetrically. Snapshots are not reached
 * from here — they hang off a project, never a song.
 */
export async function deleteSong(
  tx: Transaction,
  songId: string,
  options: SoftDeleteOptions,
): Promise<CascadeResult> {
  const marked = await tx
    .update(songs)
    .set(tombstone(options))
    .where(and(eq(songs.id, songId), eq(songs.workspaceId, options.workspaceId), live(songs)))
    .returning({ id: songs.id });

  if (marked.length === 0) return empty(options.batch);

  const markedAssets = await tx
    .update(assets)
    .set(tombstone(options))
    .where(
      and(eq(assets.songId, songId), eq(assets.workspaceId, options.workspaceId), live(assets)),
    )
    .returning({ id: assets.id });

  return {
    ...EMPTY_CASCADE(),
    batch: options.batch,
    songs: marked.map((row) => row.id),
    assets: markedAssets.map((row) => row.id),
  };
}

/**
 * Soft-delete a single asset, without touching what it hangs off.
 *
 * An asset trashed on its own has a recovery window of its own, and
 * needs both a way in and a way out. Its versions are immutable and carry no tombstone — they
 * go when the asset is finally purged, not when it is trashed.
 */
export async function deleteAsset(
  tx: Transaction,
  assetId: string,
  options: SoftDeleteOptions,
): Promise<CascadeResult> {
  const marked = await tx
    .update(assets)
    .set(tombstone(options))
    .where(and(eq(assets.id, assetId), eq(assets.workspaceId, options.workspaceId), live(assets)))
    .returning({ id: assets.id });

  return { ...EMPTY_CASCADE(), batch: options.batch, assets: marked.map((row) => row.id) };
}

/**
 * Mark the Project Files and snapshots belonging to a set of projects and their songs.
 *
 * Shared by the project and folder cascades so the two cannot drift. An asset hangs off
 * exactly one of a song or a project (`assets_one_owner`), so both sides have to be swept;
 * snapshots hang off a project only.
 */
async function cascadeToFiles(
  tx: Transaction,
  options: SoftDeleteOptions,
  projectIds: readonly string[],
  songIds: readonly string[],
): Promise<{ assets: string[]; snapshots: string[] }> {
  const owners: SQL[] = [];
  if (projectIds.length > 0) owners.push(inArray(assets.projectId, [...projectIds]) as SQL);
  if (songIds.length > 0) owners.push(inArray(assets.songId, [...songIds]) as SQL);

  const markedAssets =
    owners.length === 0
      ? []
      : await tx
          .update(assets)
          .set(tombstone(options))
          .where(and(eq(assets.workspaceId, options.workspaceId), live(assets), or(...owners)))
          .returning({ id: assets.id });

  const markedSnapshots =
    projectIds.length === 0
      ? []
      : await tx
          .update(snapshots)
          .set(tombstone(options))
          .where(
            and(
              eq(snapshots.workspaceId, options.workspaceId),
              inArray(snapshots.projectId, [...projectIds]),
              live(snapshots),
            ),
          )
          .returning({ id: snapshots.id });

  return {
    assets: markedAssets.map((row) => row.id),
    snapshots: markedSnapshots.map((row) => row.id),
  };
}

/**
 * Soft-delete a project, the songs inside it, and the files belonging to either.
 *
 * Only songs that are **currently live** are marked. A song already in the trash keeps the
 * batch of the delete that put it there, so restoring this project leaves it where its owner
 * put it.
 */
export async function deleteProject(
  tx: Transaction,
  projectId: string,
  options: SoftDeleteOptions,
): Promise<CascadeResult> {
  const markedProjects = await tx
    .update(projects)
    .set(tombstone(options))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, options.workspaceId),
        live(projects),
      ),
    )
    .returning({ id: projects.id });

  if (markedProjects.length === 0) return empty(options.batch);

  const markedSongs = await tx
    .update(songs)
    .set(tombstone(options))
    .where(
      and(eq(songs.projectId, projectId), eq(songs.workspaceId, options.workspaceId), live(songs)),
    )
    .returning({ id: songs.id });

  const projectIds = markedProjects.map((row) => row.id);
  const songIds = markedSongs.map((row) => row.id);
  const files = await cascadeToFiles(tx, options, projectIds, songIds);

  return {
    ...EMPTY_CASCADE(),
    batch: options.batch,
    projects: projectIds,
    songs: songIds,
    ...files,
  };
}

/**
 * Soft-delete a folder, everything nested under it, and everything filed in any of them.
 *
 * The subtree comes from the materialized path — a prefix match, not a recursive walk. This
 * is the third place task `021`'s path pays for itself.
 */
export async function deleteFolder(
  tx: Transaction,
  folderId: string,
  options: SoftDeleteOptions,
): Promise<CascadeResult> {
  const [target] = await tx
    .select({ path: folders.path })
    .from(folders)
    .where(
      and(eq(folders.id, folderId), eq(folders.workspaceId, options.workspaceId), live(folders)),
    );

  if (!target) return empty(options.batch);

  const subtree = and(
    eq(folders.workspaceId, options.workspaceId),
    like(folders.path, `${target.path}%`),
    live(folders),
  );

  const markedFolders = await tx
    .update(folders)
    .set(tombstone(options))
    .where(subtree)
    .returning({ id: folders.id });

  const folderIds = markedFolders.map((row) => row.id);

  // `inArray`, not a hand-written `= any(...)`: Drizzle expands a JS array into separate
  // placeholders there, which Postgres reads as a row constructor rather than an array.
  const markedProjects =
    folderIds.length === 0
      ? []
      : await tx
          .update(projects)
          .set(tombstone(options))
          .where(
            and(
              eq(projects.workspaceId, options.workspaceId),
              inArray(projects.folderId, folderIds),
              live(projects),
            ),
          )
          .returning({ id: projects.id });

  const projectIds = markedProjects.map((row) => row.id);

  const markedSongs =
    projectIds.length === 0
      ? []
      : await tx
          .update(songs)
          .set(tombstone(options))
          .where(
            and(
              eq(songs.workspaceId, options.workspaceId),
              inArray(songs.projectId, projectIds),
              live(songs),
            ),
          )
          .returning({ id: songs.id });

  const songIds = markedSongs.map((row) => row.id);
  const files = await cascadeToFiles(tx, options, projectIds, songIds);

  return {
    ...EMPTY_CASCADE(),
    batch: options.batch,
    folders: folderIds,
    projects: projectIds,
    songs: songIds,
    ...files,
  };
}

const clearTombstone = { deletedAt: null, deletedBy: null, purgeAfter: null, deletedBatch: null };

/** Raised when a restore would leave a row pointing at something still in the trash. */
export class RestoreBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreBlockedError';
  }
}

/**
 * Restore everything a given delete removed — exactly that, and nothing else.
 *
 * Symmetry is the whole property. Restoring by re-deriving the cascade would resurrect rows
 * that were already in the trash before it ran; restoring by batch cannot.
 *
 * Two repairs happen on the way back:
 *
 *   - A project whose folder is still deleted comes back **unfiled** rather than pointing at
 *     something invisible. Unfiled is a state the product already has, so this is a place the
 *     user can find it, not a special case.
 *   - A song whose project is still deleted **blocks** the restore, because `project_id` is
 *     not null and there is nowhere honest to put it. Restoring the project silently would be
 *     a bigger action than the one asked for.
 */
export async function restoreBatch(
  tx: Transaction,
  batch: string,
  workspaceId: string,
): Promise<CascadeResult> {
  const inBatch = (table: Cascaded): SQL =>
    and(
      eq(table.workspaceId, workspaceId),
      eq(table.deletedBatch, batch),
      isNotNull(table.deletedAt),
    ) as SQL;

  // Songs first, so the check below sees projects still marked deleted.
  const blocked = await tx
    .select({ songId: songs.id, projectId: songs.projectId })
    .from(songs)
    .innerJoin(projects, eq(projects.id, songs.projectId))
    .where(
      and(inBatch(songs), isNotNull(projects.deletedAt), sql`${projects.deletedBatch} <> ${batch}`),
    );

  if (blocked.length > 0) {
    const first = blocked[0];
    throw new RestoreBlockedError(
      `song ${first?.songId} cannot be restored while project ${first?.projectId} is in the trash. ` +
        'Restore the project first.',
    );
  }

  // An asset has exactly one owner and no unfiled state to fall back on, so it blocks for the
  // same reason a song does rather than coming back attached to something invisible.
  const blockedOnSong = await tx
    .select({ assetId: assets.id, ownerId: songs.id })
    .from(assets)
    .innerJoin(songs, eq(songs.id, assets.songId))
    .where(
      and(inBatch(assets), isNotNull(songs.deletedAt), sql`${songs.deletedBatch} <> ${batch}`),
    );

  const blockedOnProject = await tx
    .select({ assetId: assets.id, ownerId: projects.id })
    .from(assets)
    .innerJoin(projects, eq(projects.id, assets.projectId))
    .where(
      and(
        inBatch(assets),
        isNotNull(projects.deletedAt),
        sql`${projects.deletedBatch} <> ${batch}`,
      ),
    );

  const blockedAsset = blockedOnSong[0] ?? blockedOnProject[0];
  if (blockedAsset !== undefined) {
    throw new RestoreBlockedError(
      `asset ${blockedAsset.assetId} cannot be restored while ${blockedAsset.ownerId} is in the ` +
        'trash. Restore its song or project first.',
    );
  }

  const blockedSnapshot = await tx
    .select({ snapshotId: snapshots.id, projectId: projects.id })
    .from(snapshots)
    .innerJoin(projects, eq(projects.id, snapshots.projectId))
    .where(
      and(
        inBatch(snapshots),
        isNotNull(projects.deletedAt),
        sql`${projects.deletedBatch} <> ${batch}`,
      ),
    );

  const firstSnapshot = blockedSnapshot[0];
  if (firstSnapshot !== undefined) {
    throw new RestoreBlockedError(
      `snapshot ${firstSnapshot.snapshotId} cannot be restored while project ` +
        `${firstSnapshot.projectId} is in the trash. Restore the project first.`,
    );
  }

  const restoredFolders = await tx
    .update(folders)
    .set(clearTombstone)
    .where(inBatch(folders))
    .returning({ id: folders.id });

  // A project whose folder did not come back with it lands unfiled.
  const orphanedProjects = await tx
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(folders, eq(folders.id, projects.folderId))
    .where(and(inBatch(projects), isNotNull(folders.deletedAt)));

  if (orphanedProjects.length > 0) {
    await tx
      .update(projects)
      .set({ folderId: null })
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(
            projects.id,
            orphanedProjects.map((row) => row.id),
          ),
        ),
      );
  }

  const restoredProjects = await tx
    .update(projects)
    .set(clearTombstone)
    .where(inBatch(projects))
    .returning({ id: projects.id });

  const restoredSongs = await tx
    .update(songs)
    .set(clearTombstone)
    .where(inBatch(songs))
    .returning({ id: songs.id });

  const restoredAssets = await tx
    .update(assets)
    .set(clearTombstone)
    .where(inBatch(assets))
    .returning({ id: assets.id });

  const restoredSnapshots = await tx
    .update(snapshots)
    .set(clearTombstone)
    .where(inBatch(snapshots))
    .returning({ id: snapshots.id });

  return {
    batch,
    folders: restoredFolders.map((row) => row.id),
    projects: restoredProjects.map((row) => row.id),
    songs: restoredSongs.map((row) => row.id),
    assets: restoredAssets.map((row) => row.id),
    snapshots: restoredSnapshots.map((row) => row.id),
  };
}

/** The condition that excludes tombstones. Exported so `scopedQuery` applies the same one. */
export function excludeDeleted(table: { deletedAt: unknown }): SQL {
  return isNull(table.deletedAt as Parameters<typeof isNull>[0]) as SQL;
}

/** True for a table that carries the soft-delete columns. */
export function hasSoftDelete(table: object): table is { deletedAt: unknown } {
  return 'deletedAt' in table;
}
