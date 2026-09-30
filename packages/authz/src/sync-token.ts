import {
  NO_ACCESS,
  SYNC_TOKEN_ACTIONS,
  type Action,
  type EffectiveAccess,
} from '@youandfriends/contracts';
import { permissionGrants, syncDevices, syncTokens, type Database } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import { isActive } from './resolve';
import type { SyncTokenSubject, Target } from './subjects';

/**
 * What a Mac sync token may do (task `110`, ADR 0005) — resolved here, inside the authorizer, on
 * every check, never remembered past one request.
 *
 * A token reaches a target only if **all** of these hold, now:
 *
 * 1. The target is a **project** — Project Files are where it uploads. Never a song (its lyrics,
 *    comments, versions), never a folder, never the workspace.
 * 2. The token and its device are live: not revoked, not expired.
 * 3. The token holds a grant on **exactly** this project. No inheritance: a project grant does
 *    not reach its songs, and a folder is not a destination.
 * 4. The person who paired the device can still edit that project. A token never outlives, or
 *    exceeds, its owner's own access.
 *
 * Even then it may only `edit` (`SYNC_TOKEN_ACTIONS`) — not view, download, comment, manage, or
 * invite — which `can` enforces for every caller.
 */
export async function syncTokenAccess(
  db: Database,
  subject: SyncTokenSubject,
  target: Target,
  now: Date,
  ownerMayEdit: (userId: string) => Promise<boolean>,
): Promise<EffectiveAccess> {
  if (target.scopeType !== 'project') return NO_ACCESS;
  const [token] = await db
    .select({
      createdBy: syncTokens.createdBy,
      expiresAt: syncTokens.expiresAt,
    })
    .from(syncTokens)
    .innerJoin(
      syncDevices,
      and(
        eq(syncDevices.id, syncTokens.deviceId),
        eq(syncDevices.workspaceId, syncTokens.workspaceId),
      ),
    )
    .where(
      and(
        eq(syncTokens.id, subject.tokenId),
        eq(syncTokens.workspaceId, target.workspaceId),
        isNull(syncTokens.revokedAt),
        isNull(syncDevices.revokedAt),
      ),
    );
  if (token === undefined) return NO_ACCESS;
  if (token.expiresAt !== null && token.expiresAt <= now) return NO_ACCESS;

  const grants = await db
    .select({
      role: permissionGrants.role,
      isDeny: permissionGrants.isDeny,
      startsAt: permissionGrants.startsAt,
      endsAt: permissionGrants.endsAt,
      scopeType: permissionGrants.scopeType,
      scopeId: permissionGrants.scopeId,
      canDownload: permissionGrants.canDownload,
      canInvite: permissionGrants.canInvite,
    })
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, target.workspaceId),
        eq(permissionGrants.subjectKind, 'sync_token'),
        eq(permissionGrants.subjectId, subject.tokenId),
        eq(permissionGrants.scopeType, 'project'),
        eq(permissionGrants.scopeId, target.scopeId),
      ),
    );
  const destination = grants.some(
    (grant) => !grant.isDeny && grant.role !== null && isActive(grant, now),
  );
  if (!destination) return NO_ACCESS;

  if (!(await ownerMayEdit(token.createdBy))) return NO_ACCESS;
  // Append into Project Files, and nothing more: no download, no invitations.
  return { role: 'editor', canDownload: false, canInvite: false };
}

/** Whether a sync token may attempt this action at all, whatever it resolved to. */
export function syncTokenMay(action: Action): boolean {
  return (SYNC_TOKEN_ACTIONS as readonly Action[]).includes(action);
}
