import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../client';
import { folders } from '../schema/folders';
import type { Transaction } from '../transaction';

/**
 * Folders: creation, renaming, moving, and the plain workspace listing.
 *
 * **No authorization here**, as everywhere in this package. Whether a caller may see, create,
 * rename, move, or delete a given folder is decided in `packages/authz` (task `040`:
 * `@youandfriends/authz`'s `loadVisibleFolders`, and `assertCan` at the call site) before any
 * function here runs. `listWorkspaceFolders` in particular returns every live folder in a
 * workspace with no filtering at all — it exists so the authorization layer has something to
 * filter, not so a route can call it directly.
 *
 * Cycle prevention, the same-workspace-parent check, and the materialized-path rewrite on move
 * are all enforced by the `folders_before_write`/`folders_after_move` triggers in
 * `migrations/0000_core_schema.sql` — nothing here re-implements them. A write that would
 * violate one of those invariants raises a real Postgres error, which callers here catch only
 * for the one outcome that is a normal, expected user action: two folders that would end up
 * with the same name under the same parent.
 */

export type FolderRow = typeof folders.$inferSelect;

export type FolderWriteResult =
  | { readonly ok: true; readonly folder: FolderRow }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'name_conflict' }
  | { readonly ok: false; readonly reason: 'invalid_parent' };

/** The SQLSTATE behind a Drizzle error, if this is a Postgres error at all. */
function sqlState(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } } | undefined)?.cause?.code;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

/** Every live folder in a workspace, deepest-path-last so a parent always precedes its children. */
export async function listWorkspaceFolders(
  db: Database,
  workspaceId: string,
): Promise<FolderRow[]> {
  return db
    .select()
    .from(folders)
    .where(and(eq(folders.workspaceId, workspaceId), isNull(folders.deletedAt)))
    .orderBy(asc(folders.path));
}

/** One live folder, or `null` if it does not exist in this workspace. */
export async function getFolder(
  db: Database,
  workspaceId: string,
  folderId: string,
): Promise<FolderRow | null> {
  const [row] = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.workspaceId, workspaceId),
        isNull(folders.deletedAt),
      ),
    );
  return row ?? null;
}

export interface CreateFolderInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentId: string | null;
  readonly name: string;
}

/**
 * Create a folder. `name_conflict` is a normal user outcome (two folders offered the same name
 * under the same parent); anything else the database raises is passed through unrecognized to
 * the caller.
 */
export async function createFolder(
  tx: Transaction,
  input: CreateFolderInput,
): Promise<FolderWriteResult> {
  try {
    const [row] = await tx
      .insert(folders)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        name: input.name,
      })
      .returning();
    if (row === undefined) throw new Error('folder insert returned nothing');
    return { ok: true, folder: row };
  } catch (error) {
    const code = sqlState(error);
    if (code === UNIQUE_VIOLATION) return { ok: false, reason: 'name_conflict' };
    if (code === FOREIGN_KEY_VIOLATION || code === CHECK_VIOLATION) {
      return { ok: false, reason: 'invalid_parent' };
    }
    throw error;
  }
}

/** Rename a folder in place. */
export async function renameFolder(
  tx: Transaction,
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<FolderWriteResult> {
  try {
    const [row] = await tx
      .update(folders)
      .set({ name })
      .where(
        and(
          eq(folders.id, folderId),
          eq(folders.workspaceId, workspaceId),
          isNull(folders.deletedAt),
        ),
      )
      .returning();
    return row === undefined ? { ok: false, reason: 'not_found' } : { ok: true, folder: row };
  } catch (error) {
    if (sqlState(error) === UNIQUE_VIOLATION) return { ok: false, reason: 'name_conflict' };
    throw error;
  }
}

/**
 * Move a folder under a new parent, or to the root when `newParentId` is `null`.
 *
 * The subtree rewrite is the `folders_after_move` trigger's job, inside this same statement's
 * transaction — nothing here walks descendants. A cycle, a parent from another workspace, or a
 * parent that no longer exists all surface as `invalid_parent`; the caller pre-checks the
 * ordinary cases (task `040`'s use cases resolve the destination through `authz` first, so this
 * is the defense against a race, not the primary check).
 */
export async function moveFolder(
  tx: Transaction,
  workspaceId: string,
  folderId: string,
  newParentId: string | null,
): Promise<FolderWriteResult> {
  try {
    const [row] = await tx
      .update(folders)
      .set({ parentId: newParentId })
      .where(
        and(
          eq(folders.id, folderId),
          eq(folders.workspaceId, workspaceId),
          isNull(folders.deletedAt),
        ),
      )
      .returning();
    return row === undefined ? { ok: false, reason: 'not_found' } : { ok: true, folder: row };
  } catch (error) {
    const code = sqlState(error);
    if (code === UNIQUE_VIOLATION) return { ok: false, reason: 'name_conflict' };
    if (code === FOREIGN_KEY_VIOLATION || code === CHECK_VIOLATION) {
      return { ok: false, reason: 'invalid_parent' };
    }
    throw error;
  }
}
