import {
  AUDIT_ACTION_INFO,
  AUDIT_ACTIONS,
  AUDIT_CLASSES,
  actionsInClass,
  type AuditAction,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { presignedUrl, providerSecretKey, syncToken } from '@youandfriends/config/fixtures';
import { auditEvents, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { safeMetadata, withAuditedTransaction } from '../audit';
import { assertWorkspaceOwner, MAX_AUDIT_PAGE, queryAuditEvents } from '../audit-query';
import { anonymous, memberSubject, shareLinkSubject, syncTokenSubject } from '../subjects';
import { caught, expectNotFoundShape } from './helpers';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING audit tests: ${reason}`);
}

describe('the audit vocabulary', () => {
  it('covers every class docs/DESIGN.md §13 names', () => {
    for (const auditClass of AUDIT_CLASSES) {
      // A class with no action is a class nothing can be recorded under, and the gap would
      // only surface during the investigation that needed it.
      expect(actionsInClass(auditClass).length, `${auditClass} has no actions`).toBeGreaterThan(0);
    }
  });

  it('names the task that emits every action', () => {
    for (const action of AUDIT_ACTIONS) {
      // An action with no emitter is a gap. Naming the task makes it visible in one place
      // rather than discoverable only by grepping for callers.
      expect(AUDIT_ACTION_INFO[action].emittedBy, `${action} has no emitter`).toMatch(/^\d{3}$/);
    }
  });

  it('assigns every action to exactly one class', () => {
    const counted = AUDIT_CLASSES.flatMap((auditClass) => actionsInClass(auditClass));
    expect(counted).toHaveLength(AUDIT_ACTIONS.length);
    expect(new Set(counted).size).toBe(AUDIT_ACTIONS.length);
  });
});

describe('audit event ids', () => {
  it('are ULID-shaped, so the contract\u2019s validators accept them', async () => {
    const { isUlid } = await import('@youandfriends/contracts');
    const { auditIdForTests } = await import('../audit');
    expect(isUlid(auditIdForTests())).toBe(true);
  });

  it('sort in the order they were issued, even within one millisecond', async () => {
    const { auditIdForTests } = await import('../audit');
    // Several events are written inside one transaction — "renamed, then deleted" — and they
    // share a timestamp to the millisecond. A purely random suffix would sort them
    // arbitrarily, and an investigation would read the effect before the cause.
    const ids = Array.from({ length: 200 }, () => auditIdForTests());
    expect([...ids].sort()).toEqual(ids);
  });

  it('are unique', async () => {
    const { auditIdForTests } = await import('../audit');
    const ids = Array.from({ length: 1000 }, () => auditIdForTests());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('metadata redaction', () => {
  it('redacts a presigned URL, whatever it is called', () => {
    // A presigned URL is a bearer credential for its TTL, and this table is the one designed
    // never to be edited — a credential that lands here stays there (THREAT_MODEL T3).
    expect(safeMetadata({ url: presignedUrl })).toEqual({ url: '[redacted]' });
  });

  it('redacts a secret by key name', () => {
    expect(safeMetadata({ clientSecret: 'anything' })).toEqual({ clientSecret: '[redacted]' });
  });

  it('redacts a sync token and a provider key by shape', () => {
    expect(safeMetadata({ note: syncToken })).toEqual({ note: '[redacted]' });
    expect(safeMetadata({ note: providerSecretKey })).toEqual({ note: '[redacted]' });
  });

  it('redacts nested values, not only top-level ones', () => {
    expect(safeMetadata({ request: { headers: { authorization: 'Bearer x' } } })).toEqual({
      request: { headers: { authorization: '[redacted]' } },
    });
  });

  it('keeps ordinary detail readable', () => {
    // Over-redaction costs a debugging round trip; this is what the log is for.
    const useful = { songTitle: 'Blue Hour', versionNumber: 3, reason: 'replaced by a new mix' };
    expect(safeMetadata(useful)).toEqual(useful);
  });

  it('treats absent metadata as empty, not as null', () => {
    expect(safeMetadata(undefined)).toEqual({});
  });

  it('drops a non-object rather than storing something unexamined', () => {
    expect(safeMetadata(['not', 'an', 'object'] as unknown as Record<string, unknown>)).toEqual({});
  });
});

describeWithDatabase('audit emission', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('audit');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function eventsFor(workspaceId: string) {
    return db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));
  }

  it('writes an event in the same transaction as the change', async () => {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`);

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ tx, audit }) => {
        await tx.execute(sql`update projects set name = 'Renamed' where id = ${project.id}`);
        await audit({
          action: 'project.updated',
          targetType: 'project',
          targetId: project.id,
          metadata: { from: 'Project', to: 'Renamed' },
        });
      },
    );

    const events = await eventsFor(workspace.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'project.updated',
      targetType: 'project',
      targetId: project.id,
      actorKind: 'member',
      actorId: user.id,
      metadata: { from: 'Project', to: 'Renamed' },
    });
  });

  it('leaves no event when the action rolls back', async () => {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Doomed ${testId()}`);

    await expect(
      withAuditedTransaction(
        db,
        { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
        async ({ tx, audit }) => {
          await audit({ action: 'project.deleted', targetType: 'project', targetId: project.id });
          await tx.execute(sql`delete from projects where id = ${project.id}`);
          throw new Error('deliberate');
        },
      ),
    ).rejects.toThrow();

    // An event for something that did not happen is worse than no event: it is a lie in the
    // one record an investigation trusts.
    expect(await eventsFor(workspace.id)).toEqual([]);
    const { rows } = await db.execute(
      sql`select count(*)::int as n from projects where id = ${project.id}`,
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('records the actor’s subject kind, not just an id', async () => {
    const { workspace } = await makeTenant(db);
    const tokenId = testId();

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: syncTokenSubject(tokenId) },
      async ({ audit }) => {
        await audit({ action: 'upload.completed', targetType: 'asset', targetId: testId() });
      },
    );

    const [event] = await eventsFor(workspace.id);
    // A sync upload attributed to a bare user id loses the device it came from, which is
    // exactly what an investigation needs.
    expect(event).toMatchObject({ actorKind: 'sync_token', actorId: tokenId });
  });

  it('records an anonymous actor with no id', async () => {
    const { workspace } = await makeTenant(db);

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: anonymous },
      async ({ audit }) => {
        await audit({ action: 'access.denied', targetType: 'song', targetId: testId() });
      },
    );

    const [event] = await eventsFor(workspace.id);
    expect(event).toMatchObject({ actorKind: 'anonymous', actorId: null });
  });

  it('carries the correlation id that joins it to the logs', async () => {
    const { user, workspace } = await makeTenant(db);
    const correlationId = `req_${testId()}`;

    await withAuditedTransaction(
      db,
      {
        workspaceId: workspace.id as WorkspaceId,
        actor: memberSubject(user.id as never),
        correlationId,
      },
      async ({ audit }) => {
        await audit({ action: 'permission.granted', targetType: 'permission_grant' });
      },
    );

    const [event] = await eventsFor(workspace.id);
    expect(event?.correlationId).toBe(correlationId);
  });

  it('redacts metadata on the way in, not on the way out', async () => {
    const { user, workspace } = await makeTenant(db);

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        await audit({
          action: 'version.downloaded',
          targetType: 'version',
          metadata: { downloadUrl: presignedUrl, songTitle: 'Blue Hour' },
        });
      },
    );

    // Read the raw column: the credential must not be in the durable record at all.
    const { rows } = await db.execute(
      sql`select metadata::text as raw from audit_events where workspace_id = ${workspace.id}`,
    );
    const raw = (rows[0] as { raw: string }).raw;
    expect(raw).not.toContain('X-Amz-Signature');
    expect(raw).toContain('[redacted]');
    expect(raw).toContain('Blue Hour');
  });

  it('writes several events in one transaction, in order', async () => {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Multi ${testId()}`);
    const song = await makeSong(db, workspace.id, project.id, 'Track');

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        await audit({ action: 'song.updated', targetType: 'song', targetId: song.id });
        await audit({ action: 'song.deleted', targetType: 'song', targetId: song.id });
      },
    );

    const events = await eventsFor(workspace.id);
    // Sorted by id, not timestamp: two events in one transaction share a timestamp, and an
    // investigation needs them in the order they happened.
    const ordered = [...events].sort((a, b) => a.id.localeCompare(b.id));
    expect(ordered.map((event) => event.action)).toEqual(['song.updated', 'song.deleted']);
  });

  it('accepts an event of every class', async () => {
    const { user, workspace } = await makeTenant(db);
    const representative = AUDIT_CLASSES.map((auditClass) => actionsInClass(auditClass)[0]);

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        for (const action of representative) {
          await audit({ action: action as AuditAction, targetType: 'workspace' });
        }
      },
    );

    // The helper covers every class today; each class's real emission point is wired by the
    // task named in `AUDIT_ACTION_INFO`.
    const events = await eventsFor(workspace.id);
    expect(events).toHaveLength(AUDIT_CLASSES.length);
  });
});

describeWithDatabase('append-only enforcement', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase('audit_immutable');
    db = database.db;

    const { user, workspace } = await makeTenant(db);
    workspaceId = workspace.id;
    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        await audit({ action: 'permission.granted', targetType: 'permission_grant' });
      },
    );
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('rejects an update', async () => {
    const error = await caught(
      db.execute(
        sql`update audit_events set action = 'access.granted' where workspace_id = ${workspaceId}`,
      ),
    );
    expect((error as { cause?: { message?: string } }).cause?.message).toMatch(/append-only/);
  });

  it('rejects a delete', async () => {
    const error = await caught(
      db.execute(sql`delete from audit_events where workspace_id = ${workspaceId}`),
    );
    expect((error as { cause?: { message?: string } }).cause?.message).toMatch(/append-only/);
  });

  it('rejects a truncate, which row triggers do not see', async () => {
    // `TRUNCATE` bypasses row-level triggers entirely. Without its own statement-level
    // trigger the table would be append-only right up until someone reached for the fast way
    // to empty it.
    const error = await caught(db.execute(sql`truncate audit_events`));
    expect((error as { cause?: { message?: string } }).cause?.message).toMatch(/append-only/);
  });

  it('leaves the row intact after every rejected attempt', async () => {
    const { rows } = await db.execute(
      sql`select count(*)::int as n from audit_events where workspace_id = ${workspaceId}`,
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('refuses to let a workspace delete take its history with it', async () => {
    const { user, workspace } = await makeTenant(db);
    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        await audit({ action: 'member.added', targetType: 'member' });
      },
    );

    // A cascade here would destroy the record as a side effect of another action — and
    // because a cascading DELETE is a real DELETE, it trips the append-only trigger and
    // fails confusingly anyway. Refusing at the foreign key is the clearer statement:
    // purging a tenant's history is a deliberate retention procedure (docs/DESIGN.md §13).
    const error = await caught(db.execute(sql`delete from workspaces where id = ${workspace.id}`));
    expect((error as { cause?: { code?: string } }).cause?.code).toBe('23503');

    const { rows } = await db.execute(
      sql`select count(*)::int as n from audit_events where workspace_id = ${workspace.id}`,
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describeWithDatabase('reading the audit log', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('audit_read');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function seed(count: number) {
    const { user, workspace } = await makeTenant(db);
    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        for (let index = 0; index < count; index += 1) {
          await audit({ action: 'song.updated', targetType: 'song', targetId: `S${index}` });
        }
      },
    );
    return { user, workspace };
  }

  it('returns a workspace owner their own log, newest first', async () => {
    const { user, workspace } = await seed(3);

    const events = await queryAuditEvents(
      db,
      memberSubject(user.id as never),
      workspace.id as WorkspaceId,
    );

    expect(events).toHaveLength(3);
    const ids = events.map((event) => event.id);
    expect([...ids].sort().reverse()).toEqual(ids);
  });

  it('refuses a non-owner member, 404-shaped', async () => {
    const { workspace } = await seed(1);
    const editor = await makeUser(db);
    await db.execute(sql`
      insert into workspace_memberships (id, workspace_id, user_id, role)
      values (${testId()}, ${workspace.id}, ${editor.id}, 'editor')
    `);

    // The log records what every collaborator did. A curious editor browsing it is the
    // reconnaissance an attacker with a foothold would want.
    expectNotFoundShape(
      await caught(
        queryAuditEvents(db, memberSubject(editor.id as never), workspace.id as WorkspaceId),
      ),
    );
  });

  it('refuses an owner of a different workspace', async () => {
    const mine = await makeTenant(db);
    const theirs = await seed(1);

    expectNotFoundShape(
      await caught(
        queryAuditEvents(
          db,
          memberSubject(mine.user.id as never),
          theirs.workspace.id as WorkspaceId,
        ),
      ),
    );
  });

  it('refuses a non-member subject kind outright', async () => {
    const { workspace } = await seed(1);

    for (const subject of [shareLinkSubject(testId()), syncTokenSubject(testId()), anonymous]) {
      expectNotFoundShape(await caught(queryAuditEvents(db, subject, workspace.id as WorkspaceId)));
    }
  });

  it('never returns another workspace’s rows', async () => {
    const mine = await seed(2);
    await seed(2);

    const events = await queryAuditEvents(
      db,
      memberSubject(mine.user.id as never),
      mine.workspace.id as WorkspaceId,
    );

    expect(events.every((event) => event.workspaceId === mine.workspace.id)).toBe(true);
  });

  it('filters by target and by action', async () => {
    const { user, workspace } = await seed(3);
    const subject = memberSubject(user.id as never);

    const byTarget = await queryAuditEvents(db, subject, workspace.id as WorkspaceId, {
      targetId: 'S1',
    });
    expect(byTarget).toHaveLength(1);

    const byAction = await queryAuditEvents(db, subject, workspace.id as WorkspaceId, {
      action: 'song.deleted',
    });
    expect(byAction).toEqual([]);
  });

  it('pages with a keyset, and caps the page size', async () => {
    const { user, workspace } = await seed(5);
    const subject = memberSubject(user.id as never);

    const first = await queryAuditEvents(db, subject, workspace.id as WorkspaceId, { limit: 2 });
    expect(first).toHaveLength(2);

    const next = await queryAuditEvents(db, subject, workspace.id as WorkspaceId, {
      limit: 2,
      before: first[1]?.id,
    });
    expect(next).toHaveLength(2);
    expect(next.map((event) => event.id)).not.toContain(first[0]?.id);

    // An unbounded read of a log that only grows is a request that gets slower forever.
    const capped = await queryAuditEvents(db, subject, workspace.id as WorkspaceId, {
      limit: MAX_AUDIT_PAGE + 1000,
    });
    expect(capped.length).toBeLessThanOrEqual(MAX_AUDIT_PAGE);
  });

  it('exposes the ownership check on its own, for callers that only need the guard', async () => {
    const { user, workspace } = await seed(1);

    await expect(
      assertWorkspaceOwner(db, memberSubject(user.id as never), workspace.id as WorkspaceId),
    ).resolves.toBeUndefined();
  });
});

describeWithDatabase('access decisions as audit events', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('audit_decisions');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('records a refusal in the same transaction as the attempt', async () => {
    const { createAuthorizer } = await import('../authorizer');
    const { auditDecisions } = await import('../audit');
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);
    const theirProject = await makeProject(db, theirs.workspace.id, `Theirs ${testId()}`);
    const theirSong = await makeSong(db, theirs.workspace.id, theirProject.id, 'Theirs');

    await withAuditedTransaction(
      db,
      {
        workspaceId: mine.workspace.id as WorkspaceId,
        actor: memberSubject(mine.user.id as never),
      },
      async ({ audit }) => {
        const authorizer = createAuthorizer(db, {
          onDecision: auditDecisions(audit, { onlyRefusals: true }),
        });
        await authorizer.can(memberSubject(mine.user.id as never), 'view', {
          workspaceId: mine.workspace.id as WorkspaceId,
          scopeType: 'song',
          scopeId: theirSong.id,
        });
      },
    );

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, mine.workspace.id));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'access.denied',
      targetType: 'song',
      targetId: theirSong.id,
      metadata: { attemptedAction: 'view' },
    });
  });

  it('records nothing for an allowed check when only refusals are wanted', async () => {
    const { createAuthorizer } = await import('../authorizer');
    const { auditDecisions } = await import('../audit');
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Mine ${testId()}`);
    const song = await makeSong(db, workspace.id, project.id, 'Mine');

    await withAuditedTransaction(
      db,
      { workspaceId: workspace.id as WorkspaceId, actor: memberSubject(user.id as never) },
      async ({ audit }) => {
        const authorizer = createAuthorizer(db, {
          onDecision: auditDecisions(audit, { onlyRefusals: true }),
        });
        await authorizer.can(memberSubject(user.id as never), 'view', {
          workspaceId: workspace.id as WorkspaceId,
          scopeType: 'song',
          scopeId: song.id,
        });
      },
    );

    // A permission check runs on every read in the product. A row per check would drown the
    // log it exists to make readable.
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));
    expect(events).toEqual([]);
  });

  it('surfaces a failed audit write rather than losing it', async () => {
    const { createAuthorizer } = await import('../authorizer');
    const { workspace, user } = await makeTenant(db);

    // A sink that cannot write must fail the decision, not be swallowed. Fire-and-forget here
    // is the silently-incomplete log ADR 0006 rules out.
    const authorizer = createAuthorizer(db, {
      onDecision: () => Promise.reject(new Error('audit write failed')),
    });

    await expect(
      authorizer.can(memberSubject(user.id as never), 'view', {
        workspaceId: workspace.id as WorkspaceId,
        scopeType: 'song',
        scopeId: testId(),
      }),
    ).rejects.toThrow('audit write failed');
  });
});
