import type { WorkspaceId } from '@youandfriends/contracts';
import {
  getProjectHeader,
  getSongHeader,
  workspaceMemberships,
  type Database,
} from '@youandfriends/db';
import { eq } from 'drizzle-orm';

import { loadProjectCollaborators, loadSongCollaborators } from './library';

/**
 * Who can open a notification's target right now (tasks `095`–`096`): the people it may be
 * about, decided by the same resolver as every other read. Empty for a target that is gone, in
 * the trash, or not in this workspace. The workspace itself is its full members.
 *
 * Used when a notification is generated and again when an email is sent, because access can be
 * revoked between the two.
 */
export async function loadTargetAudience(
  db: Database,
  workspaceId: WorkspaceId,
  targetType: 'song' | 'project' | 'workspace',
  targetId: string,
  now: () => Date = () => new Date(),
): Promise<string[]> {
  if (targetType === 'song') {
    const song = await getSongHeader(db, workspaceId, targetId);
    if (song === null) return [];
    return loadSongCollaborators(
      db,
      workspaceId,
      { id: song.id, projectId: song.projectId, folderPath: song.folderPath },
      now,
    );
  }
  if (targetType === 'project') {
    const project = await getProjectHeader(db, workspaceId, targetId);
    if (project === null) return [];
    const reach = await loadProjectCollaborators(
      db,
      workspaceId,
      [{ id: project.id, folderPath: project.folderPath }],
      now,
    );
    return reach.get(project.id) ?? [];
  }
  if (targetId !== workspaceId) return [];
  const rows = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, workspaceId));
  return rows.map((row) => row.userId);
}

/** A target's display name for a notification: a song's title, a project's name. */
export async function targetName(
  db: Database,
  workspaceId: WorkspaceId,
  targetType: 'song' | 'project' | 'workspace',
  targetId: string,
): Promise<string | null> {
  if (targetType === 'song') return (await getSongHeader(db, workspaceId, targetId))?.title ?? null;
  if (targetType === 'project') {
    return (await getProjectHeader(db, workspaceId, targetId))?.name ?? null;
  }
  return targetId === workspaceId ? 'this workspace' : null;
}
