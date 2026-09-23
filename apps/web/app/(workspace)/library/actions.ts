'use server';

import { parseServerEnv } from '@youandfriends/config';
import { AppError, folderIdSchema } from '@youandfriends/contracts';
import { revalidatePath } from 'next/cache';

import { libraryContext } from '@/lib/library/context';
import {
  createLibraryFolder,
  deleteLibraryFolder,
  moveLibraryFolder,
  renameLibraryFolder,
} from '@/lib/library/folders';
import { currentWorkspace } from '@/lib/workspace/current';

/**
 * Server actions behind the folder tree's writes (task `040`).
 *
 * Called directly from the tree component's event handlers — a drag-and-drop move or a
 * keyboard-triggered "Move to…" has no form to submit — rather than bound to a `<form action>`,
 * the way `../settings/members/actions.ts` uses them. Both are ordinary Server Actions; the
 * difference is only how the client invokes them. Each resolves its own workspace and
 * re-authorizes through the same use cases the page used to build the tree, exactly like every
 * other action in this app (`../settings/members/actions.ts`): a Server Action is a public
 * endpoint whether or not the component that calls it ever rendered.
 */

export interface FolderActionResult {
  readonly status: 'ok' | 'error';
  readonly message?: string;
}

const WORKSPACE_NOT_FOUND = 'That workspace could not be found.';
const NOT_A_FOLDER = 'That folder could not be found.';

const nullableFolderIdSchema = folderIdSchema.nullable();
const NOT_A_FOLDER_RESULT: FolderActionResult = { status: 'error', message: NOT_A_FOLDER };

/**
 * Validate a folder id crossing the Server Action boundary.
 *
 * A Server Action's arguments are not guaranteed to match their TypeScript types at runtime —
 * this is the same trust boundary `docs/THREAT_MODEL.md` requires Zod at everywhere else
 * (found in security review: `name` was already validated this way, ids were not). Not an
 * authorization bypass either way — every write still re-resolves the id through
 * `assertMayEdit`/`getFolder` — but a malformed value has no business reaching the database
 * driver un-parsed.
 */
function parseFolderId(value: unknown): string | null {
  const parsed = folderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseNullableFolderId(value: unknown): { ok: true; id: string | null } | { ok: false } {
  const parsed = nullableFolderIdSchema.safeParse(value);
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false };
}

function messageFor(error: unknown): string {
  if (error instanceof AppError) {
    if (error.publicCode === 'not_found') return 'That folder could not be found.';
    if (error.code === 'conflict') {
      return error.detail?.includes('descendant')
        ? 'A folder cannot be moved into its own subfolder.'
        : 'A folder with that name already exists here.';
    }
    if (error.code === 'validation_failed') {
      return error.fields?.[0]?.message ?? 'Check the folder name.';
    }
  }
  throw error;
}

export async function createFolderAction(
  parentId: string | null,
  name: string,
): Promise<FolderActionResult> {
  const parsedParentId = parseNullableFolderId(parentId);
  if (!parsedParentId.ok) return NOT_A_FOLDER_RESULT;

  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  try {
    await createLibraryFolder(libraryContext(context), { parentId: parsedParentId.id, name });
    revalidatePath('/library', 'layout');
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: messageFor(error) };
  }
}

export async function renameFolderAction(
  folderId: string,
  name: string,
): Promise<FolderActionResult> {
  const parsedFolderId = parseFolderId(folderId);
  if (parsedFolderId === null) return NOT_A_FOLDER_RESULT;

  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  try {
    await renameLibraryFolder(libraryContext(context), { folderId: parsedFolderId, name });
    revalidatePath('/library', 'layout');
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: messageFor(error) };
  }
}

export async function moveFolderAction(
  folderId: string,
  newParentId: string | null,
): Promise<FolderActionResult> {
  const parsedFolderId = parseFolderId(folderId);
  const parsedNewParentId = parseNullableFolderId(newParentId);
  if (parsedFolderId === null || !parsedNewParentId.ok) return NOT_A_FOLDER_RESULT;

  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  try {
    await moveLibraryFolder(libraryContext(context), {
      folderId: parsedFolderId,
      newParentId: parsedNewParentId.id,
    });
    revalidatePath('/library', 'layout');
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: messageFor(error) };
  }
}

export async function deleteFolderAction(folderId: string): Promise<FolderActionResult> {
  const parsedFolderId = parseFolderId(folderId);
  if (parsedFolderId === null) return NOT_A_FOLDER_RESULT;

  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: WORKSPACE_NOT_FOUND };

  try {
    const recoveryWindowDays = parseServerEnv().YOUANDFRIENDS_RECOVERY_WINDOW_DAYS;
    await deleteLibraryFolder(libraryContext(context), parsedFolderId, recoveryWindowDays);
    revalidatePath('/library', 'layout');
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: messageFor(error) };
  }
}
