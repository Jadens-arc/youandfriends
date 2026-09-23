import {
  deleteEntity,
  loadFolderAccess,
  loadVisibleFolders,
  withAuditedTransaction,
  workspaceRoleOf,
  type AuditContext,
  type LifecycleContext,
} from '@youandfriends/authz';
import {
  conflict,
  fieldErrorsFromZod,
  forbidden,
  newUlid,
  notFound,
  roleAtLeast,
  validationFailed,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  createFolder as insertFolder,
  getFolder,
  listWorkspaceFolders,
  moveFolder as updateFolderParent,
  renameFolder as updateFolderName,
  type CascadeResult,
  type FolderRow,
} from '@youandfriends/db';
import { z } from 'zod';

import { isSelfOrDescendant, sanitizeFolderPaths, type VisibleFolder } from './tree';

import type { LibraryContext } from './context';

/**
 * Use cases behind the library folder tree (task `040`): reading the authorized tree, and the
 * four writes an editor may make to it.
 *
 * Every write asks `docs/DESIGN.md` §3's actual boundary — editors "organize content" — so all
 * four go through the `edit` action, at the folder being changed and, for a move, at the
 * destination too. There is no scope to check against for a *root*-level create or move (no
 * folder exists yet to be its target), so those fall back to the subject's workspace-wide role,
 * the same way `assertCanInWorkspace` decides a workspace-level action.
 */

function auditContextOf(context: LibraryContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    newId: context.newId ?? newUlid,
    ...(context.now === undefined ? {} : { now: context.now }),
  };
}

const ZERO_WIDTH_JOINER = '‍';

function isInvisibleOrControl(character: string): boolean {
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(character)) return true;
  return /\p{Cf}/u.test(character) && character !== ZERO_WIDTH_JOINER;
}

/** A folder name, held to the same shape as a workspace name (`lib/workspace/settings.ts`) and
 *  for the same reason: it is rendered in the tree, in breadcrumbs, and eventually in share
 *  links, so a bidirectional override or a run of zero-width characters is a name that reads as
 *  something it is not. */
export const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the folder a name.')
  .max(120, 'Keep the name to 120 characters or fewer.')
  .refine(
    (name) => ![...name].some(isInvisibleOrControl),
    'The name cannot contain control or invisible formatting characters.',
  )
  .refine(
    (name) => /[\p{L}\p{N}\p{S}\p{P}]/u.test(name),
    'The name needs at least one visible character.',
  );

/** Whether this subject may `edit` at a root scope — no folder exists to check a grant against,
 *  so this asks the same question `assertCanInWorkspace` asks for a workspace-level action. */
async function mayEditAtRoot(context: LibraryContext): Promise<boolean> {
  const role = await workspaceRoleOf(context.db, context.subject, context.workspaceId);
  return role !== null && roleAtLeast(role, 'editor');
}

async function assertMayEdit(context: LibraryContext, folderId: string | null): Promise<void> {
  if (folderId === null) {
    if (await mayEditAtRoot(context)) return;
    throw forbidden({ detail: `${context.subject.kind} may not organize the workspace root` });
  }
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'folder',
    scopeId: folderId,
  });
}

function toVisibleFolder(row: FolderRow): VisibleFolder {
  return { id: row.id, name: row.name, parentId: row.parentId, path: row.path };
}

export interface LibraryTree {
  readonly folders: readonly VisibleFolder[];
  /** Folder ids this viewer may rename, delete, or move things into — `edit` or better. */
  readonly editableFolderIds: ReadonlySet<string>;
  readonly mayCreateAtRoot: boolean;
}

/** Every folder this subject may see in the workspace, and what they may do with each. */
export async function readLibraryTree(context: LibraryContext): Promise<LibraryTree> {
  const all = await listWorkspaceFolders(context.db, context.workspaceId);

  const [visible, roles, mayCreateAtRoot] = await Promise.all([
    loadVisibleFolders(context.db, context.subject, context.workspaceId, all),
    loadFolderAccess(context.db, context.subject, context.workspaceId, all),
    mayEditAtRoot(context),
  ]);

  const editableFolderIds = new Set(
    [...roles].filter(([, role]) => roleAtLeast(role, 'editor')).map(([id]) => id),
  );

  return {
    // Sanitized last, and only here — `getFolder`'s real, unsanitized paths are still what
    // `createLibraryFolder`/`moveLibraryFolder` correctly use for their own server-side checks.
    // This is the one boundary where the result crosses into a client component's props.
    folders: sanitizeFolderPaths(visible.map(toVisibleFolder)),
    editableFolderIds,
    mayCreateAtRoot,
  };
}

async function loadFolderOrNotFound(
  context: LibraryContext,
  folderId: string,
  workspaceId: WorkspaceId,
): Promise<FolderRow> {
  const row = await getFolder(context.db, workspaceId, folderId);
  if (row === null) throw notFound();
  return row;
}

export interface CreateFolderRequest {
  readonly parentId: string | null;
  readonly name: unknown;
}

/** Create a folder. `parentId: null` creates it at the workspace root. */
export async function createLibraryFolder(
  context: LibraryContext,
  request: CreateFolderRequest,
): Promise<VisibleFolder> {
  const parsed = folderNameSchema.safeParse(request.name);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));

  await assertMayEdit(context, request.parentId);
  if (request.parentId !== null) {
    await loadFolderOrNotFound(context, request.parentId, context.workspaceId);
  }

  const id = (context.newId ?? newUlid)();

  return withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    const result = await insertFolder(tx, {
      id,
      workspaceId: context.workspaceId,
      parentId: request.parentId,
      name: parsed.data,
    });

    if (!result.ok) {
      if (result.reason === 'name_conflict') {
        throw conflict({ detail: 'a folder with that name already exists here' });
      }
      throw notFound();
    }

    await audit({
      action: 'folder.updated',
      targetType: 'folder',
      targetId: result.folder.id,
      metadata: { field: 'created', name: result.folder.name, parentId: request.parentId },
    });

    return toVisibleFolder(result.folder);
  });
}

export interface RenameFolderRequest {
  readonly folderId: string;
  readonly name: unknown;
}

export async function renameLibraryFolder(
  context: LibraryContext,
  request: RenameFolderRequest,
): Promise<VisibleFolder> {
  const parsed = folderNameSchema.safeParse(request.name);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));

  await assertMayEdit(context, request.folderId);
  const before = await loadFolderOrNotFound(context, request.folderId, context.workspaceId);

  return withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    const result = await updateFolderName(tx, context.workspaceId, request.folderId, parsed.data);

    if (!result.ok) {
      if (result.reason === 'name_conflict') {
        throw conflict({ detail: 'a folder with that name already exists here' });
      }
      throw notFound();
    }

    if (result.folder.name !== before.name) {
      await audit({
        action: 'folder.updated',
        targetType: 'folder',
        targetId: result.folder.id,
        metadata: { field: 'name', from: before.name, to: result.folder.name },
      });
    }

    return toVisibleFolder(result.folder);
  });
}

export interface MoveFolderRequest {
  readonly folderId: string;
  readonly newParentId: string | null;
}

/** Move a folder under a new parent, or to the workspace root when `newParentId` is `null`. */
export async function moveLibraryFolder(
  context: LibraryContext,
  request: MoveFolderRequest,
): Promise<VisibleFolder> {
  await assertMayEdit(context, request.folderId);
  await assertMayEdit(context, request.newParentId);

  const folder = await loadFolderOrNotFound(context, request.folderId, context.workspaceId);

  if (request.newParentId !== null) {
    const destination = await loadFolderOrNotFound(
      context,
      request.newParentId,
      context.workspaceId,
    );
    // The database's own cycle check (`folders_before_write`) would catch this too, but only
    // after raising a raw constraint violation — checking the materialized path here first
    // means a folder dragged onto its own descendant gets a plain, expected refusal instead.
    if (isSelfOrDescendant(folder.path, destination.path)) {
      throw conflict({ detail: 'cannot move a folder into its own descendant' });
    }
  }

  return withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    const result = await updateFolderParent(
      tx,
      context.workspaceId,
      request.folderId,
      request.newParentId,
    );

    if (!result.ok) {
      if (result.reason === 'name_conflict') {
        throw conflict({ detail: 'a folder with that name already exists there' });
      }
      throw notFound();
    }

    await audit({
      action: 'folder.moved',
      targetType: 'folder',
      targetId: result.folder.id,
      metadata: { fromParentId: folder.parentId, toParentId: request.newParentId },
    });

    return toVisibleFolder(result.folder);
  });
}

/**
 * Soft-delete a folder and everything under it, one audited row at a time.
 *
 * The cascade itself lives in `packages/db`'s `deleteFolder`, reached through
 * `@youandfriends/authz`'s `deleteEntity` (task `025`) — nothing here re-implements it. Building
 * a recovery or trash interface on top is deferred (task `212`); this is only the write.
 *
 * `recoveryWindowDays` is a caller argument rather than read here, matching
 * `readWorkspaceSettings`'s `quotaBytes` (`lib/workspace/settings.ts`): it is configuration
 * (`YOUANDFRIENDS_RECOVERY_WINDOW_DAYS`), and the caller that already parsed the environment
 * stays the one place it is read.
 */
export async function deleteLibraryFolder(
  context: LibraryContext,
  folderId: string,
  recoveryWindowDays: number,
): Promise<CascadeResult> {
  await assertMayEdit(context, folderId);
  await loadFolderOrNotFound(context, folderId, context.workspaceId);

  const lifecycle: LifecycleContext = {
    workspaceId: context.workspaceId,
    actor: context.subject,
    recoveryWindowDays,
    newId: context.newId ?? newUlid,
    ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    ...(context.now === undefined ? {} : { now: context.now }),
  };

  return deleteEntity(context.db, lifecycle, 'folder', folderId);
}
