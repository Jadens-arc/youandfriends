import 'server-only';

import { syncTokenSubject } from '@youandfriends/authz';
import { unauthorized } from '@youandfriends/contracts';
import { workspaces } from '@youandfriends/db';
import { eq } from 'drizzle-orm';

import { transactionalDatabase } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/workspace/current';

import { authenticateSyncToken } from './tokens';

/**
 * The request context for the Mac agent's endpoints (task `110`): the same shape a signed-in
 * request has, so the same services serve both — with the **token** as the subject, which the
 * authorizer holds to its own narrow rules, and the pairer as the person uploads are made for.
 *
 * `/api/sync/agent/*` is reachable without a browser session (`proxy.ts`), so this is its whole
 * front door: no valid token, no context. A token is taken only from the `Authorization` header
 * — never a query string, which ends up in logs.
 */
export async function requireSyncAgent(
  request: Request,
  correlationId: string,
): Promise<WorkspaceContext> {
  const header = request.headers.get('authorization') ?? '';
  const presented = /^Bearer (\S+)$/.exec(header)?.[1];
  const db = transactionalDatabase();
  const device = presented === undefined ? null : await authenticateSyncToken(db, presented);
  if (device === null) {
    // One answer for every failure. The agent reads a 401 as "this device was disconnected"
    // and stops, rather than retrying a dead credential (ADR 0005).
    throw unauthorized({ detail: 'sync token missing, malformed, unknown, revoked, or expired' });
  }
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, device.workspaceId));
  return {
    subject: syncTokenSubject(device.tokenId),
    userId: device.userId,
    // A token holds no membership role of its own.
    workspace: { workspaceId: device.workspaceId, name: workspace?.name ?? '', role: null },
    correlationId,
  };
}
