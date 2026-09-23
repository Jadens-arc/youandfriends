import {
  ACTION_REQUIREMENTS,
  forbidden,
  NO_ACCESS,
  roleAtLeast,
  type Action,
  type EffectiveAccess,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { permissionGrants, workspaceMemberships, type Database } from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import { resolve, type MembershipBaseline, type ResolvableGrant } from './resolve';
import { inheritsMembership, subjectId, type Subject, type Target } from './subjects';
import { loadChain } from './target';

/**
 * An authorizer bound to one request.
 *
 * **Create one per request and throw it away.** The cache inside it is why: a single request
 * may check the same song a dozen times while rendering, and re-resolving each time would
 * put three queries on every one. Holding it longer would mean a revoked grant kept working
 * until the process restarted, which is exactly the window `docs/THREAT_MODEL.md` T2 rules
 * out. There is no way to invalidate it, deliberately — a cache with an invalidation API is
 * a cache someone will keep.
 */
export interface Authorizer {
  resolveAccess(subject: Subject, target: Target): Promise<EffectiveAccess>;
  assertCan(subject: Subject, action: Action, target: Target): Promise<void>;
  can(subject: Subject, action: Action, target: Target): Promise<boolean>;
}

/**
 * Called when a decision is made. Task `024` writes audit events through this.
 *
 * May return a promise, and `can` awaits it. An audit write is the intended use, and a
 * fire-and-forget audit write is exactly the silently-incomplete log ADR 0006 rules out — the
 * failure would be invisible and the record would be trusted anyway.
 */
export interface DecisionSink {
  (decision: {
    readonly subject: Subject;
    readonly target: Target;
    readonly action: Action | null;
    readonly access: EffectiveAccess;
    readonly allowed: boolean;
  }): void | Promise<void>;
}

export interface AuthorizerOptions {
  /** Injected so tests are not clock-dependent, and so a decision uses one consistent time. */
  readonly now?: () => Date;
  readonly onDecision?: DecisionSink;
}

export function createAuthorizer(db: Database, options: AuthorizerOptions = {}): Authorizer {
  const now = options.now ?? (() => new Date());
  const cache = new Map<string, Promise<EffectiveAccess>>();

  async function load(subject: Subject, target: Target): Promise<EffectiveAccess> {
    const id = subjectId(subject);
    // Anonymous has no id, so it can match no grant and hold no membership. Deny by default
    // is not a policy applied to it here; it is a fact about it.
    if (id === null) return NO_ACCESS;

    const chain = await loadChain(db, target);
    // Not found, or in another workspace — indistinguishable on purpose (THREAT_MODEL T1).
    if (chain === null) return NO_ACCESS;

    const [grants, membership] = await Promise.all([
      loadGrants(db, target.workspaceId, subject, id),
      inheritsMembership(subject) ? loadMembership(db, target.workspaceId, id) : null,
    ]);

    return resolve({ chain, grants, membership, now: now() });
  }

  function resolveAccess(subject: Subject, target: Target): Promise<EffectiveAccess> {
    const key = `${subject.kind}:${subjectId(subject) ?? ''}:${target.workspaceId}:${target.scopeType}:${target.scopeId}`;
    const cached = cache.get(key);
    if (cached) return cached;

    // The promise is cached, not the result, so concurrent checks for the same target
    // during one render share a single resolution rather than racing three of them.
    const pending = load(subject, target);
    cache.set(key, pending);
    return pending;
  }

  async function can(subject: Subject, action: Action, target: Target): Promise<boolean> {
    const access = await resolveAccess(subject, target);
    const allowed = permits(access, action);
    await options.onDecision?.({ subject, target, action, access, allowed });
    return allowed;
  }

  async function assertCan(subject: Subject, action: Action, target: Target): Promise<void> {
    if (await can(subject, action, target)) return;

    // `forbidden` serializes 404-shaped. The true code survives internally for the audit log;
    // it never reaches the client, because a 403 confirms the resource exists.
    throw forbidden({
      detail: `${subject.kind} may not ${action} ${target.scopeType} ${target.scopeId}`,
    });
  }

  return { resolveAccess, assertCan, can };
}

/** Whether an effective access permits an action. The only place the mapping is applied. */
export function permits(access: EffectiveAccess, action: Action): boolean {
  const requirement = ACTION_REQUIREMENTS[action];
  if (access.role === null) return false;
  if (!roleAtLeast(access.role, requirement.minimumRole)) return false;
  // A capability is permission to do something with a resource you can already see, so it is
  // checked in addition to the role rather than instead of it.
  return requirement.capability === undefined || access[requirement.capability];
}

async function loadGrants(
  db: Database,
  workspaceId: WorkspaceId,
  subject: Subject,
  id: string,
): Promise<ResolvableGrant[]> {
  // Every grant this subject holds in this workspace, filtered against the chain in memory.
  // The alternative — a query per chain level — is a query per folder depth on every check.
  const rows = await db
    .select({
      scopeType: permissionGrants.scopeType,
      scopeId: permissionGrants.scopeId,
      role: permissionGrants.role,
      canDownload: permissionGrants.canDownload,
      canInvite: permissionGrants.canInvite,
      isDeny: permissionGrants.isDeny,
      startsAt: permissionGrants.startsAt,
      endsAt: permissionGrants.endsAt,
    })
    .from(permissionGrants)
    .where(
      and(
        eq(permissionGrants.workspaceId, workspaceId),
        eq(permissionGrants.subjectKind, subject.kind),
        eq(permissionGrants.subjectId, id),
      ),
    );

  return rows;
}

/**
 * A membership row with no `role` carries no workspace-wide baseline (task `032`, ADR 0010):
 * it exists only so `resolveWorkspace` can route a scope-limited collaborator to the right
 * workspace, and their real access is entirely their own `permission_grants` rows. Treating it
 * the same as no row at all reuses `resolve()`'s already-proven non-member path — a share-link
 * bearer and a sync token have grants and no baseline today, and that is exactly this case too
 * — rather than teaching `resolve()` a third shape for `membership`.
 */
async function loadMembership(
  db: Database,
  workspaceId: WorkspaceId,
  userId: string,
): Promise<MembershipBaseline | null> {
  const [row] = await db
    .select({
      role: workspaceMemberships.role,
      canDownload: workspaceMemberships.canDownload,
      canInvite: workspaceMemberships.canInvite,
    })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    );

  if (row === undefined || row.role === null) return null;
  return { role: row.role, canDownload: row.canDownload, canInvite: row.canInvite };
}
