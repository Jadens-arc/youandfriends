import { memberSubject, withAuditedTransaction } from '@youandfriends/authz';
import { isUlid, newUlid, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  membershipsOf,
  workspaceName,
  type DirectDatabase,
  type MembershipSummary,
} from '@youandfriends/db';
import { and, eq, gt, sql } from 'drizzle-orm';

import { ensureWorkspace } from './provision';

/**
 * Which workspace a request is working in.
 *
 * **Resolved from the request, never assumed.** Today everyone belongs to one workspace, and
 * "the user's only workspace" would give the same answer — until the day someone is invited to
 * a second, when every query written against that assumption quietly picks one of the two. The
 * request carries a preference (a cookie, {@link WORKSPACE_COOKIE}); the membership table decides
 * whether it is honoured. Multi-workspace support is then a switcher that sets the cookie, not a
 * rewrite of every read.
 *
 * The preference is a **claim, not a credential**. It names a workspace; it does not grant
 * one. A value naming a workspace this person does not belong to is refused and recorded, and the
 * request proceeds in one they do belong to.
 */

/** Carries the selected workspace id. Not secret — authorization is re-checked every request. */
export const WORKSPACE_COOKIE = 'yaf_workspace';

/**
 * How often one person's refused selection of one workspace is recorded.
 *
 * The preference rides on every request, so an unthrottled record is one audit row per page
 * load — an ex-collaborator's stale cookie, or someone reloading in a loop, writing without limit
 * into another tenant's log (found in security review). Once an hour says everything the owner
 * needs: who, which workspace, and that it is still happening.
 */
export const REFUSED_SELECTION_WINDOW_MS = 60 * 60 * 1000;

export interface CurrentWorkspace {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly role: MembershipSummary['role'];
}

export interface ResolveWorkspaceInput {
  readonly userId: string;
  readonly displayName: string;
  /** The raw cookie value, or `null`. Untrusted. */
  readonly requested: string | null;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
}

export async function resolveWorkspace(
  db: DirectDatabase,
  input: ResolveWorkspaceInput,
): Promise<CurrentWorkspace | null> {
  let memberships = await membershipsOf(db, input.userId);

  if (memberships.length === 0) {
    // First sign-in, or someone removed from every workspace they had. Either way they are
    // signed in with nowhere to be, and provisioning is what gives them somewhere.
    await ensureWorkspace(db, input);
    memberships = await membershipsOf(db, input.userId);
  }

  // Chosen only from memberships, re-read after provisioning — never from what provisioning
  // returned. A workspace this person does not belong to is not one to put them in, even one
  // created for them.
  const fallback = memberships[0];
  if (fallback === undefined) return null;

  if (input.requested !== null) {
    const chosen = memberships.find((membership) => membership.workspaceId === input.requested);
    if (chosen !== undefined) return summarize(chosen);
    await recordRefusedSelection(db, input);
  }

  return summarize(fallback);
}

function summarize(membership: MembershipSummary): CurrentWorkspace {
  return {
    workspaceId: membership.workspaceId as WorkspaceId,
    name: membership.workspaceName,
    role: membership.role,
  };
}

/**
 * Record an attempt to work in a workspace this person does not belong to.
 *
 * Written into **that** workspace's log: it is that tenant's security event, and its owner is
 * the one who needs to see that someone reached for it (`docs/THREAT_MODEL.md` T1). At most once
 * per person per workspace per {@link REFUSED_SELECTION_WINDOW_MS}. Nothing is
 * written for a value that is not an id, or names no workspace — there is no tenant to attribute
 * it to, and inventing one would put a fabricated row in the table that exists to be trusted.
 */
async function recordRefusedSelection(
  db: DirectDatabase,
  input: ResolveWorkspaceInput,
): Promise<void> {
  const requested = input.requested;
  if (requested === null || !isUlid(requested)) return;
  if ((await workspaceName(db, requested)) === null) return;

  const now = (input.now ?? (() => new Date()))();

  await withAuditedTransaction(
    db,
    {
      workspaceId: requested as WorkspaceId,
      actor: memberSubject(input.userId as UserId),
      correlationId: input.correlationId,
      newId: input.newId ?? newUlid,
      now: () => now,
    },
    async ({ tx, audit }) => {
      // Serialize concurrent requests from one person about one workspace, so a burst of
      // parallel requests cannot all pass the check below. Released at commit.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`select:${requested}:${input.userId}`}, 0))`,
      );

      const [recent] = await tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, requested),
            eq(auditEvents.action, 'access.denied'),
            eq(auditEvents.actorId, input.userId),
            gt(auditEvents.occurredAt, new Date(now.getTime() - REFUSED_SELECTION_WINDOW_MS)),
            sql`${auditEvents.metadata}->>'attemptedAction' = 'select_workspace'`,
          ),
        )
        .limit(1);
      if (recent !== undefined) return;

      await audit({
        action: 'access.denied',
        targetType: 'workspace',
        targetId: requested,
        metadata: { attemptedAction: 'select_workspace' },
      });
    },
  );
}

/**
 * Whether this person may select a workspace — the check a switcher runs before setting
 * {@link WORKSPACE_COOKIE}.
 *
 * Refusing here is a courtesy, not the control: resolution re-checks membership on every request
 * whatever the cookie says. It exists so a switcher never writes a preference that is about to be
 * refused and recorded as a failed access.
 */
export async function maySelectWorkspace(
  db: DirectDatabase,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const memberships = await membershipsOf(db, userId);
  return memberships.some((membership) => membership.workspaceId === workspaceId);
}
