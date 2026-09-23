import { memberSubject, withAuditedTransaction } from '@youandfriends/authz';
import { newUlid, type AuditAction, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  membershipsOf,
  type DirectDatabase,
  type PooledDatabase,
} from '@youandfriends/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ensureWorkspace } from '@/lib/workspace/provision';

import { identityFrom } from './identity';
import { findUserByClerkId, provisionUser } from './provision';

/**
 * Auditing sign-in, sign-out, and session revocation, from Clerk's session webhooks.
 *
 * **Why a webhook.** Signing out is a conversation between the browser and Clerk; this server
 * is never told. Revocation happens in Clerk's dashboard or API, also out of sight. A sign-in
 * could be inferred from a request, but only by keeping a table of Clerk session ids already
 * seen — a second record of something Clerk already records and reports. So all three come
 * from the one source that actually observes them, verified by signature in the route
 * (`app/api/webhooks/clerk/route.ts`) before anything here runs.
 *
 * **Which workspace.** Every audit row belongs to a tenant (`audit_events.workspace_id` is
 * `NOT NULL`, the reason this moved here from task `030`). A session belongs to a person, not a
 * workspace, so the event is written into every workspace they are a member of: each owner sees
 * their own collaborators come and go, and none sees anything about a workspace they do not
 * own.
 *
 * **At-least-once, recorded once.** Clerk's delivery retries until it gets a 2xx, and one
 * sign-out can arrive as both `session.ended` and `session.removed`. Each (workspace, action,
 * Clerk session) is recorded once, checked under a transaction-scoped advisory lock so two
 * deliveries racing each other cannot both pass the check.
 */

/** Clerk's user, as a webhook carries it. Only the fields provisioning reads are required. */
const clerkUserJsonSchema = z.object({
  id: z.string().min(1),
  primary_email_address_id: z.string().nullish(),
  email_addresses: z
    .array(z.object({ id: z.string(), email_address: z.string() }))
    .nullish()
    .transform((addresses) => addresses ?? []),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
});

export const SESSION_EVENT_ACTIONS = {
  'session.created': 'auth.signed_in',
  // Clerk ends a session on sign-out and removes it from the client; either may arrive, and
  // often both do. Both are the person signing out.
  'session.ended': 'auth.signed_out',
  'session.removed': 'auth.signed_out',
  'session.revoked': 'auth.session_revoked',
} as const satisfies Record<string, AuditAction>;

type SessionEventType = keyof typeof SESSION_EVENT_ACTIONS;

const sessionEventSchema = z.object({
  type: z.enum(Object.keys(SESSION_EVENT_ACTIONS) as [SessionEventType, ...SessionEventType[]]),
  data: z.object({
    /** Clerk's session id. Not a credential — the session token is — but the join key here. */
    id: z.string().min(1),
    user_id: z.string().min(1),
    /** Present when the session is an impersonation. Worth a flag on every event it touches. */
    actor: z.record(z.string(), z.unknown()).nullish(),
    user: clerkUserJsonSchema.nullish(),
  }),
});

export type SessionEventOutcome =
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'unattributable'; readonly reason: string }
  | { readonly kind: 'recorded'; readonly recorded: number; readonly duplicates: number };

export interface SessionEventDependencies {
  /** For the audit transactions. */
  readonly db: DirectDatabase;
  /** For the `users` upsert, which is written against the pooled driver (`provision.ts`). */
  readonly users: PooledDatabase;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

/**
 * Record one verified Clerk event.
 *
 * `event` has passed signature verification but is still parsed: a signed payload is proof of
 * who sent it, not of its shape. Anything that is not a session event is `ignored` — the
 * endpoint may be subscribed to more than it needs, and refusing those would make Clerk retry
 * them forever.
 */
export async function recordSessionEvent(
  deps: SessionEventDependencies,
  event: unknown,
  deliveryId: string | undefined,
): Promise<SessionEventOutcome> {
  const type = (event as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !Object.hasOwn(SESSION_EVENT_ACTIONS, type)) {
    return { kind: 'ignored', reason: `not a session event: ${String(type)}` };
  }

  const parsed = sessionEventSchema.safeParse(event);
  if (!parsed.success) {
    return { kind: 'unattributable', reason: `unrecognized ${type} payload` };
  }

  const { data } = parsed.data;
  const action = SESSION_EVENT_ACTIONS[parsed.data.type];
  const newId = deps.newId ?? newUlid;

  // What the payload says about the person, derived exactly as the request path derives it —
  // so whichever path provisions them, the row says the same thing. Only trusted when it is
  // about the user the session belongs to.
  const identity =
    data.user && data.user.id === data.user_id
      ? identityFrom({
          id: data.user.id,
          primaryEmail:
            data.user.email_addresses.find(
              (address) => address.id === data.user?.primary_email_address_id,
            )?.email_address ?? null,
          emails: data.user.email_addresses.map((address) => address.email_address),
          firstName: data.user.first_name ?? null,
          lastName: data.user.last_name ?? null,
          username: data.user.username ?? null,
        })
      : null;
  // The same refusal as the request path: no email, no row (`session.ts`).
  const provisionable = action === 'auth.signed_in' && identity !== null && identity.email !== '';

  let user = await findUserByClerkId(deps.db, data.user_id);

  // A sign-in can reach this endpoint before the browser's first request reaches the app, and
  // then there is no row yet. Provision from the payload rather than drop the first sign-in.
  if (user === null && provisionable) {
    const provisioned = await provisionUser(deps.users, identity, newId);
    user = { id: provisioned.userId };
  }

  if (user === null) {
    return { kind: 'unattributable', reason: `no user for ${type}` };
  }

  let memberships = await membershipsOf(deps.db, user.id);
  if (memberships.length === 0 && provisionable) {
    await ensureWorkspace(deps.db, {
      userId: user.id,
      displayName: identity.displayName,
      now: deps.now,
      newId,
      correlationId: deliveryId,
    });
    memberships = await membershipsOf(deps.db, user.id);
  }

  if (memberships.length === 0) {
    return { kind: 'unattributable', reason: `${user.id} belongs to no workspace` };
  }

  let recorded = 0;
  let duplicates = 0;
  const actor = memberSubject(user.id as UserId);
  const impersonated = data.actor !== null && data.actor !== undefined;

  for (const membership of memberships) {
    const wrote = await withAuditedTransaction(
      deps.db,
      {
        workspaceId: membership.workspaceId as WorkspaceId,
        actor,
        correlationId: deliveryId,
        newId,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      },
      async ({ tx, audit }) => {
        // Serialize deliveries about the same session in the same workspace. Transaction-scoped,
        // so it is released on commit or rollback and cannot leak across a pooled connection.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${membership.workspaceId}:${action}:${data.id}`}, 0))`,
        );

        const [already] = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.workspaceId, membership.workspaceId),
              eq(auditEvents.action, action),
              sql`${auditEvents.metadata}->>'clerkSessionId' = ${data.id}`,
            ),
          )
          .limit(1);
        if (already !== undefined) return false;

        await audit({
          action,
          targetType: 'session',
          // Clerk's session id is not one of ours and does not fit the ULID column, so it is
          // carried in metadata rather than truncated into a reference that points nowhere.
          metadata: { clerkSessionId: data.id, clerkEvent: parsed.data.type, impersonated },
        });
        return true;
      },
    );

    if (wrote) recorded += 1;
    else duplicates += 1;
  }

  return { kind: 'recorded', recorded, duplicates };
}
