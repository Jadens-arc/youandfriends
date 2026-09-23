import { AppError } from '@youandfriends/contracts';
import { parseServerEnv } from '@youandfriends/config';
import { notFound } from 'next/navigation';

import { WorkspaceSettingsView } from '@/components/settings/workspace-settings';
import { currentWorkspace, workspaceRequest } from '@/lib/workspace/current';
import { readWorkspaceSettings } from '@/lib/workspace/settings';

import { renameWorkspaceAction } from './actions';

export const metadata = { title: 'Settings · You & Friends' };

/**
 * Workspace settings: name, storage against the configured quota, and members (task `031`).
 *
 * The quota is read from configuration on every render (`YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`,
 * ADR 0001) — never a constant — so changing it is a redeploy of configuration, not of code.
 */
export default async function SettingsPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();

  const settings = await readWorkspaceSettings(
    workspaceRequest(context),
    parseServerEnv().YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES,
  ).catch((error: unknown) => {
    // 404-shaped, whichever the cause: a refusal must not confirm the workspace exists.
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });

  return <WorkspaceSettingsView settings={settings} renameAction={renameWorkspaceAction} />;
}
