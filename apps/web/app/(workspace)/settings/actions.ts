'use server';

import { AppError } from '@youandfriends/contracts';
import { revalidatePath } from 'next/cache';

import type { RenameState } from '@/components/settings/rename-form';
import { currentWorkspace, workspaceRequest } from '@/lib/workspace/current';
import { renameCurrentWorkspace } from '@/lib/workspace/settings';

/**
 * Rename the current workspace.
 *
 * A server action is a public endpoint — it can be called without the form ever being rendered
 * — so it resolves the workspace from the request and `renameCurrentWorkspace` authorizes it
 * through `packages/authz`, exactly as if the page had never hidden the form.
 *
 * Refusals come back as the same "not found" a missing workspace would, never "forbidden"
 * (`docs/THREAT_MODEL.md` T1).
 */
export async function renameWorkspaceAction(
  _state: RenameState,
  formData: FormData,
): Promise<RenameState> {
  const context = await currentWorkspace();
  if (context === null) return { status: 'error', message: 'That workspace could not be found.' };

  try {
    const { name } = await renameCurrentWorkspace(workspaceRequest(context), formData.get('name'));
    revalidatePath('/', 'layout');
    return { status: 'saved', name };
  } catch (error) {
    if (error instanceof AppError && error.code === 'validation_failed') {
      return { status: 'error', message: error.fields?.[0]?.message ?? 'Check the name.' };
    }
    if (error instanceof AppError && error.publicCode === 'not_found') {
      return { status: 'error', message: 'That workspace could not be found.' };
    }
    throw error;
  }
}
