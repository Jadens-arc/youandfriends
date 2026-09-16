import { and, eq, inArray, isNull, isNotNull, like, sql, type SQL } from 'drizzle-orm';

import { folders, projects, songs } from './schema/index';
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
}

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

const live = (table: typeof folders | typeof projects | typeof songs): SQL =>
  isNull(table.deletedAt) as SQL;

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
 * Soft-delete a song. The leaf case: nothing cascades from here.
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

  return { batch: options.batch, folders: [], projects: [], songs: marked.map((row) => row.id) };
}

/**
 * Soft-delete a project and the songs inside it.
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

  if (markedProjects.length === 0) {
    return { batch: options.batch, folders: [], projects: [], songs: [] };
  }

  const markedSongs = await tx
    .update(songs)
    .set(tombstone(options))
    .where(
      and(eq(songs.projectId, projectId), eq(songs.workspaceId, options.workspaceId), live(songs)),
    )
    .returning({ id: songs.id });

  return {
    batch: options.batch,
    folders: [],
    projects: markedProjects.map((row) => row.id),
    songs: markedSongs.map((row) => row.id),
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

  if (!target) {
    return { batch: options.batch, folders: [], projects: [], songs: [] };
  }

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

  return {
    batch: options.batch,
    folders: folderIds,
    projects: projectIds,
    songs: markedSongs.map((row) => row.id),
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
  const inBatch = (table: typeof folders | typeof projects | typeof songs): SQL =>
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

  return {
    batch,
    folders: restoredFolders.map((row) => row.id),
    projects: restoredProjects.map((row) => row.id),
    songs: restoredSongs.map((row) => row.id),
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
