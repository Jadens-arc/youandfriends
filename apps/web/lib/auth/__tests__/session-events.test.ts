import {
  auditEvents,
  users,
  workspaces,
  type DirectDatabase,
  type PooledDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordSessionEvent, type SessionEventDependencies } from '../session-events';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING session audit tests: ${reason}`);

/**
 * Sign-in, sign-out and revocation, as Clerk reports them.
 *
 * What the fixture needs for each rule to bite (CLAUDE.md §13): a person in **two** workspaces
 * (one event per workspace, not one per person), a **populated workspace they are not in** (which
 * must receive nothing), the **same event delivered twice** and a sign-out arriving as **both**
 * `session.ended` and `session.removed` (recorded once each way), and a person with **no row yet**
 * (provisioned from the payload rather than dropped).
 */
describeWithDatabase('recording Clerk session events', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let deps: SessionEventDependencies;

  beforeAll(async () => {
    database = await createTestDatabase('web_session_events');
    db = database.db;
    // The users upsert is written against the pooled type; same SQL either way.
    deps = { db, users: db as unknown as PooledDatabase };
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  let sessionCounter = 0;
  const sessionId = () => `sess_test${(sessionCounter += 1)}`;

  const event = (
    type: string,
    clerkUserId: string,
    session: string,
    extra: Record<string, unknown> = {},
  ) => ({
    type,
    object: 'event',
    data: { id: session, user_id: clerkUserId, actor: null, user: null, ...extra },
  });

  const sessionEventsFor = (workspaceId: string) =>
    db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.targetType, 'session')));

  it('records a sign-in in the workspace the person belongs to', async () => {
    const { user, workspace } = await makeTenant(db);
    const session = sessionId();

    const outcome = await recordSessionEvent(
      deps,
      event('session.created', user.clerkUserId, session),
      'msg_1',
    );

    expect(outcome).toEqual({ kind: 'recorded', recorded: 1, duplicates: 0 });
    const [row] = await sessionEventsFor(workspace.id);
    expect(row).toMatchObject({
      action: 'auth.signed_in',
      actorKind: 'member',
      actorId: user.id,
      targetType: 'session',
      correlationId: 'msg_1',
      metadata: { clerkSessionId: session, clerkEvent: 'session.created', impersonated: false },
    });
  });

  it('records it in every workspace they belong to, and in no other', async () => {
    const own = await makeTenant(db);
    const other = await makeTenant(db);
    const bystander = await makeTenant(db);
    await addMember(db, other.workspace.id, own.user.id, 'viewer');

    const outcome = await recordSessionEvent(
      deps,
      event('session.created', own.user.clerkUserId, sessionId()),
      undefined,
    );

    expect(outcome).toMatchObject({ recorded: 2 });
    expect(await sessionEventsFor(own.workspace.id)).toHaveLength(1);
    expect(await sessionEventsFor(other.workspace.id)).toHaveLength(1);
    expect(await sessionEventsFor(bystander.workspace.id)).toHaveLength(0);
  });

  it('records a redelivered event once', async () => {
    const { user, workspace } = await makeTenant(db);
    const signIn = event('session.created', user.clerkUserId, sessionId());

    await recordSessionEvent(deps, signIn, 'msg_a');
    const again = await recordSessionEvent(deps, signIn, 'msg_a');

    expect(again).toEqual({ kind: 'recorded', recorded: 0, duplicates: 1 });
    expect(await sessionEventsFor(workspace.id)).toHaveLength(1);
  });

  it('records one sign-out when Clerk reports it as both ended and removed', async () => {
    const { user, workspace } = await makeTenant(db);
    const session = sessionId();

    await recordSessionEvent(deps, event('session.ended', user.clerkUserId, session), 'msg_e');
    await recordSessionEvent(deps, event('session.removed', user.clerkUserId, session), 'msg_r');

    const rows = await sessionEventsFor(workspace.id);
    expect(rows.map((row) => row.action)).toEqual(['auth.signed_out']);
  });

  it('serializes racing deliveries, so both cannot pass the duplicate check', async () => {
    // Deterministic, not hopeful: an outside connection holds the very lock the recorder takes,
    // so both deliveries must be seen **waiting on it** before it is released. Without the lock
    // they never wait, and this fails by name rather than passing on lucky timing.
    const { user, workspace } = await makeTenant(db);
    const session = sessionId();
    const observer = new Client({ connectionString: database.url });
    await observer.connect();
    const key = `${workspace.id}:auth.signed_out:${session}`;

    try {
      await observer.query('select pg_advisory_lock(hashtextextended($1, 0))', [key]);

      const deliveries = Promise.all([
        recordSessionEvent(deps, event('session.ended', user.clerkUserId, session), 'msg_e'),
        recordSessionEvent(deps, event('session.removed', user.clerkUserId, session), 'msg_r'),
      ]);

      await waitForWaiters(observer, 2);
      await observer.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);

      const outcomes = await deliveries;
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(['recorded', 'recorded']);
      expect(await sessionEventsFor(workspace.id)).toHaveLength(1);
    } finally {
      await observer.end();
    }
  }, 30_000);

  it('keeps separate sessions separate', async () => {
    const { user, workspace } = await makeTenant(db);
    await recordSessionEvent(
      deps,
      event('session.created', user.clerkUserId, sessionId()),
      undefined,
    );
    await recordSessionEvent(
      deps,
      event('session.created', user.clerkUserId, sessionId()),
      undefined,
    );
    expect(await sessionEventsFor(workspace.id)).toHaveLength(2);
  });

  it('records a revocation as a revocation, not a sign-out', async () => {
    const { user, workspace } = await makeTenant(db);
    await recordSessionEvent(
      deps,
      event('session.revoked', user.clerkUserId, sessionId()),
      undefined,
    );
    const [row] = await sessionEventsFor(workspace.id);
    expect(row?.action).toBe('auth.session_revoked');
  });

  it('flags an impersonated session on the record', async () => {
    const { user, workspace } = await makeTenant(db);
    await recordSessionEvent(
      deps,
      event('session.created', user.clerkUserId, sessionId(), { actor: { sub: 'user_support' } }),
      undefined,
    );
    const [row] = await sessionEventsFor(workspace.id);
    expect(row?.metadata).toMatchObject({ impersonated: true });
  });

  it('provisions someone whose first sign-in arrives before their first request', async () => {
    const clerkUserId = 'user_brandnew';
    const outcome = await recordSessionEvent(
      deps,
      event('session.created', clerkUserId, sessionId(), {
        user: {
          id: clerkUserId,
          primary_email_address_id: 'idn_2',
          email_addresses: [
            { id: 'idn_1', email_address: 'old@example.test' },
            { id: 'idn_2', email_address: 'avery@example.test' },
          ],
          first_name: 'Avery',
          last_name: null,
          username: null,
        },
      }),
      'msg_first',
    );

    expect(outcome).toMatchObject({ kind: 'recorded', recorded: 1 });
    const [person] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId));
    // The primary address, not the first in the list — the same derivation as the request path.
    expect(person).toMatchObject({ email: 'avery@example.test', displayName: 'Avery' });

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, person?.id ?? ''));
    expect(workspace?.name).toBe('Avery’s workspace');
    const actions = (
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspace?.id ?? ''))
    ).map((row) => row.action);
    expect(actions.sort()).toEqual(['auth.signed_in', 'workspace.created']);
  });

  it('does not provision from a payload describing somebody else', async () => {
    // A user object whose id differs from the session's owner. Provisioning from it would create
    // one person's row from another's details.
    const outcome = await recordSessionEvent(
      deps,
      event('session.created', 'user_owner_of_session', sessionId(), {
        user: {
          id: 'user_someone_else',
          email_addresses: [{ id: 'idn', email_address: 'else@example.test' }],
        },
      }),
      undefined,
    );
    expect(outcome.kind).toBe('unattributable');
    expect(
      await db.select().from(users).where(eq(users.clerkUserId, 'user_owner_of_session')),
    ).toHaveLength(0);
  });

  it('does not provision on a sign-out, and says it could not attribute it', async () => {
    const outcome = await recordSessionEvent(
      deps,
      event('session.ended', 'user_never_seen', sessionId(), {
        user: {
          id: 'user_never_seen',
          email_addresses: [{ id: 'i', email_address: 'n@example.test' }],
        },
      }),
      undefined,
    );
    expect(outcome.kind).toBe('unattributable');
    expect(
      await db.select().from(users).where(eq(users.clerkUserId, 'user_never_seen')),
    ).toHaveLength(0);
  });

  it('cannot attribute an event for someone with no workspace, and writes nothing', async () => {
    const loner = await makeUser(db);
    const before = await db.select().from(auditEvents);
    const outcome = await recordSessionEvent(
      deps,
      event('session.ended', loner.clerkUserId, sessionId()),
      undefined,
    );
    expect(outcome.kind).toBe('unattributable');
    expect(await db.select().from(auditEvents)).toHaveLength(before.length);
  });

  it('ignores events that are not about sessions, including prototype names', async () => {
    for (const type of ['user.updated', 'email.created', 'constructor', 'toString', 42]) {
      expect(await recordSessionEvent(deps, { type, data: {} }, undefined)).toMatchObject({
        kind: 'ignored',
      });
    }
    expect(await recordSessionEvent(deps, null, undefined)).toMatchObject({ kind: 'ignored' });
  });

  it('refuses a session event whose shape it does not recognize', async () => {
    const outcome = await recordSessionEvent(
      deps,
      { type: 'session.created', data: { id: 42 } },
      undefined,
    );
    expect(outcome.kind).toBe('unattributable');
  });
});

/** Wait until `count` backends in this database are blocked on a lock. */
async function waitForWaiters(observer: Client, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: string }>(
      `select count(*)::text as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(result.rows[0]?.waiting ?? '0') >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} deliveries waiting on the session lock; they never blocked`);
}
