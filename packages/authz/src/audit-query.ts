import {
  forbidden,
  type AuditAction,
  type AuditTargetType,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { auditEvents, workspaceMemberships, type Database } from '@youandfriends/db';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';

import { inheritsMembership, type Subject } from './subjects';

/**
 * Reading the audit log.
 *
 * Owners only. The log records who did what and when for every collaborator, so it is exactly
 * the kind of thing a curious editor should not be able to browse — and exactly the kind of
 * reconnaissance an attacker with a foothold would want. A refusal is `forbidden`, which
 * serializes 404-shaped (`docs/THREAT_MODEL.md` T1).
 *
 * The administration UI is deferred to task `207`; this is the query path it will use, and
 * the access rule it will inherit.
 */

export interface AuditQuery {
  readonly action?: AuditAction | undefined;
  readonly targetType?: AuditTargetType | undefined;
  readonly targetId?: string | undefined;
  readonly actorId?: string | undefined;
  /** Keyset pagination: rows strictly older than this. Ids are time-sortable. */
  readonly before?: string | undefined;
  readonly limit?: number | undefined;
}

/** The ceiling, so a caller cannot ask for the whole log in one request by accident. */
export const MAX_AUDIT_PAGE = 200;

export async function queryAuditEvents(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
  query: AuditQuery = {},
): Promise<(typeof auditEvents.$inferSelect)[]> {
  await assertWorkspaceOwner(db, subject, workspaceId);

  const filters: SQL[] = [eq(auditEvents.workspaceId, workspaceId)];
  if (query.action !== undefined) filters.push(eq(auditEvents.action, query.action));
  if (query.targetType !== undefined) filters.push(eq(auditEvents.targetType, query.targetType));
  if (query.targetId !== undefined) filters.push(eq(auditEvents.targetId, query.targetId));
  if (query.actorId !== undefined) filters.push(eq(auditEvents.actorId, query.actorId));
  if (query.before !== undefined) filters.push(lt(auditEvents.id, query.before));

  return (
    db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      // Newest first, by id rather than timestamp: two events in one transaction share a
      // timestamp, and an investigation needs them in the order they happened.
      .orderBy(desc(auditEvents.id))
      .limit(Math.min(query.limit ?? 50, MAX_AUDIT_PAGE))
  );
}

/**
 * Require workspace ownership.
 *
 * Deliberately not `assertCan`: that resolves access to a folder, project, or song, and the
 * audit log is none of those — it belongs to the workspace itself. Routing it through a scope
 * chain would mean inventing a scope for it, and an invented scope is a scope nobody
 * validates.
 */
export async function assertWorkspaceOwner(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
): Promise<void> {
  if (!inheritsMembership(subject)) {
    throw forbidden({ detail: `${subject.kind} cannot read the audit log` });
  }

  const [membership] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, subject.userId),
      ),
    );

  if (membership?.role !== 'owner') {
    throw forbidden({
      detail: `user ${subject.userId} is not an owner of ${workspaceId}`,
    });
  }
}
