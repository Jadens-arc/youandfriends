import {
  forbidden,
  roleAtLeast,
  WORKSPACE_ACTION_REQUIREMENTS,
  type Role,
  type WorkspaceAction,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { workspaceMemberships, type Database } from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import { inheritsMembership, type Subject } from './subjects';

/**
 * Decisions about the workspace itself — its settings and its member list.
 *
 * Only the membership row answers these. A permission grant is attached to a folder, a project,
 * or a song, and none of those is the workspace; a grant of `owner` on a folder makes someone
 * the owner of that folder, not of the member list (see `WORKSPACE_ACTIONS` in `contracts`).
 *
 * Only members are ever members. A share-link bearer or a sync token is refused before any
 * query, because neither can hold a membership by construction and asking would only invite a
 * future id collision to answer yes.
 */

/** The role this subject holds in this workspace, or `null` if it holds none. */
export async function workspaceRoleOf(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
): Promise<Role | null> {
  if (!inheritsMembership(subject)) return null;

  const [membership] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, subject.userId),
      ),
    );

  return membership?.role ?? null;
}

/** Whether this subject may perform a workspace-level action. */
export async function canInWorkspace(
  db: Database,
  subject: Subject,
  action: WorkspaceAction,
  workspaceId: WorkspaceId,
): Promise<boolean> {
  const role = await workspaceRoleOf(db, subject, workspaceId);
  return role !== null && roleAtLeast(role, WORKSPACE_ACTION_REQUIREMENTS[action].minimumRole);
}

/**
 * The same decision, as a guard. Throws `forbidden`, which serializes 404-shaped: a refusal to
 * show a workspace's members must not confirm the workspace exists (`docs/THREAT_MODEL.md` T1).
 */
export async function assertCanInWorkspace(
  db: Database,
  subject: Subject,
  action: WorkspaceAction,
  workspaceId: WorkspaceId,
): Promise<void> {
  if (await canInWorkspace(db, subject, action, workspaceId)) return;
  throw forbidden({ detail: `${subject.kind} may not ${action} workspace ${workspaceId}` });
}
