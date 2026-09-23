import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  markStorageUsageStale,
  membersOf,
  membershipsOf,
  provisionWorkspace,
  renameWorkspace,
  storageUsage,
  STORAGE_USAGE_TTL_MS,
} from '../queries/workspace';
import { workspaceMemberships, workspaces } from '../schema/index';
import { withTransaction } from '../transaction';
import { addMember, makeStorageObject, makeTenant, makeUser, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING workspace query tests: ${reason}`);
}

/**
 * What each rule needs in the fixture before it can bite (CLAUDE.md §13):
 *
 *  - "only for someone with nowhere to be" needs a person who **already** belongs somewhere;
 *  - "at most one per person" needs two transactions **genuinely** racing — both past the
 *    membership check before either commits — or the check alone would pass the test;
 *  - every tenant filter needs a **populated** foreign workspace: objects, members, a name.
 */
describeWithDatabase('the workspace itself', () => {
  let database: TestDatabase;
  let db: TestDatabase['db'];

  beforeAll(async () => {
    database = await createTestDatabase('workspace_queries');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const provision = (userId: string, name = 'Blue Hour') =>
    withTransaction(db, (tx) =>
      provisionWorkspace(tx, { userId, name, workspaceId: testId(), membershipId: testId() }),
    );

  describe('provisioning', () => {
    it('gives a person with nowhere to be a workspace they own', async () => {
      const user = await makeUser(db);

      const outcome = await provision(user.id);

      expect(outcome?.created).toBe(true);
      const memberships = await membershipsOf(db, user.id);
      expect(memberships).toEqual([
        { workspaceId: outcome?.workspaceId, workspaceName: 'Blue Hour', role: 'owner' },
      ]);

      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, outcome?.workspaceId ?? ''));
      expect(row?.ownerUserId).toBe(user.id);
      expect(row?.provisionedForUserId).toBe(user.id);
    });

    it('does nothing the second time', async () => {
      const user = await makeUser(db);
      await provision(user.id);

      expect(await provision(user.id)).toBeNull();
      expect(await membershipsOf(db, user.id)).toHaveLength(1);
    });

    it('does not give an invited collaborator an empty workspace of their own', async () => {
      // The row that makes the rule bite: this person already belongs somewhere. Delete the
      // membership check and they are handed a second, empty workspace beside the one they
      // were invited to — and land in it by default, because it is not the first they joined.
      const { workspace } = await makeTenant(db);
      const collaborator = await makeUser(db);
      await addMember(db, workspace.id, collaborator.id, 'editor');

      expect(await provision(collaborator.id)).toBeNull();

      const owned = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, collaborator.id));
      expect(owned).toHaveLength(0);
    });

    it('creates exactly one workspace when two first requests race', async () => {
      // Both transactions must be past the membership check before either commits; otherwise
      // the second simply sees the first's membership and this proves nothing about the key.
      // Transaction A provisions and holds its commit. B starts, passes the check (A is not
      // visible to it), and blocks on the unique index. Only once B is observed waiting on a lock
      // is A allowed to commit — so B's outcome is decided by the constraint and nothing else.
      const user = await makeUser(db);
      const observer = new Client({ connectionString: database.url });
      await observer.connect();

      try {
        let releaseA!: () => void;
        const aMayCommit = new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        let aProvisioned!: () => void;
        const aHasProvisioned = new Promise<void>((resolve) => {
          aProvisioned = resolve;
        });

        const a = withTransaction(db, async (tx) => {
          const outcome = await provisionWorkspace(tx, {
            userId: user.id,
            name: 'From A',
            workspaceId: testId(),
            membershipId: testId(),
          });
          aProvisioned();
          await aMayCommit;
          return outcome;
        });

        await aHasProvisioned;
        const b = withTransaction(db, (tx) =>
          provisionWorkspace(tx, {
            userId: user.id,
            name: 'From B',
            workspaceId: testId(),
            membershipId: testId(),
          }),
        );

        await waitForLockWait(observer);
        releaseA();

        const [fromA, fromB] = await Promise.all([a, b]);

        expect(fromA?.created).toBe(true);
        expect(fromB).toEqual({ workspaceId: fromA?.workspaceId, created: false });

        const owned = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id));
        expect(owned.map((row) => row.name)).toEqual(['From A']);
        expect(await membershipsOf(db, user.id)).toHaveLength(1);
      } finally {
        await observer.end();
      }
    }, 30_000);
  });

  describe('storage usage', () => {
    it('sums this workspace’s objects and no one else’s', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      await makeStorageObject(db, mine.workspace.id, { sizeBytes: 1_000 });
      await makeStorageObject(db, mine.workspace.id, { sizeBytes: 2_500 });
      // The row a missing tenant filter would add.
      await makeStorageObject(db, theirs.workspace.id, { sizeBytes: 9_999_999 });

      const usage = await storageUsage(db, mine.workspace.id, new Date());
      expect(usage?.usedBytes).toBe(3_500);
    });

    it('reports zero, not null, for a workspace that stores nothing', async () => {
      const { workspace } = await makeTenant(db);
      expect((await storageUsage(db, workspace.id, new Date()))?.usedBytes).toBe(0);
    });

    it('serves the cached figure until it is stale', async () => {
      const { workspace } = await makeTenant(db);
      const start = new Date('2026-09-22T10:00:00Z');
      await makeStorageObject(db, workspace.id, { sizeBytes: 100 });
      expect((await storageUsage(db, workspace.id, start))?.usedBytes).toBe(100);

      await makeStorageObject(db, workspace.id, { sizeBytes: 50 });

      // Inside the TTL: the cache answers, and the new object is not yet counted. If this read
      // recomputed, the cache would be decoration and the settings page would scan on every load.
      const inside = new Date(start.getTime() + STORAGE_USAGE_TTL_MS - 1);
      expect((await storageUsage(db, workspace.id, inside))?.usedBytes).toBe(100);

      const after = new Date(start.getTime() + STORAGE_USAGE_TTL_MS);
      const refreshed = await storageUsage(db, workspace.id, after);
      expect(refreshed?.usedBytes).toBe(150);
      expect(refreshed?.refreshedAt.toISOString()).toBe(after.toISOString());
    });

    it('recomputes on the next read once marked stale', async () => {
      const { workspace } = await makeTenant(db);
      const now = new Date('2026-09-22T10:00:00Z');
      await storageUsage(db, workspace.id, now);
      await makeStorageObject(db, workspace.id, { sizeBytes: 4_096 });

      await markStorageUsageStale(db, workspace.id);

      // Same instant — well inside the TTL — and still recomputed.
      expect((await storageUsage(db, workspace.id, now))?.usedBytes).toBe(4_096);
    });

    it('invalidates only the workspace it names', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      const now = new Date();
      await storageUsage(db, mine.workspace.id, now);
      await storageUsage(db, theirs.workspace.id, now);

      await markStorageUsageStale(db, mine.workspace.id);

      const rows = await db.select().from(workspaces);
      const byId = new Map(rows.map((row) => [row.id, row.storageUsageRefreshedAt]));
      expect(byId.get(mine.workspace.id)).toBeNull();
      expect(byId.get(theirs.workspace.id)).not.toBeNull();
    });

    it('returns null for a workspace that does not exist', async () => {
      expect(await storageUsage(db, testId(), new Date())).toBeNull();
    });
  });

  describe('members and names', () => {
    it('lists this workspace’s members in the order they joined, and no one else’s', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');
      // A populated foreign workspace, with a member who must not appear.
      const elsewhere = await makeTenant(db);
      const stranger = await makeUser(db);
      await addMember(db, elsewhere.workspace.id, stranger.id, 'viewer');

      const members = await membersOf(db, workspace.id);
      expect(members.map((member) => [member.userId, member.role])).toEqual([
        [owner.id, 'owner'],
        [editor.id, 'editor'],
      ]);
    });

    it('lists someone’s workspaces oldest membership first', async () => {
      const first = await makeTenant(db);
      const second = await makeTenant(db);
      const person = await makeUser(db);
      await addMember(db, first.workspace.id, person.id, 'viewer');
      await addMember(db, second.workspace.id, person.id, 'editor');

      const memberships = await membershipsOf(db, person.id);
      expect(memberships.map((m) => m.workspaceId)).toEqual([
        first.workspace.id,
        second.workspace.id,
      ]);
    });

    it('renames, returning the name it replaced', async () => {
      const { workspace } = await makeTenant(db);
      const result = await withTransaction(db, (tx) =>
        renameWorkspace(tx, workspace.id, 'Late Night Sessions'),
      );
      expect(result).toEqual({ previousName: 'Test Workspace' });

      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.name).toBe('Late Night Sessions');
    });

    it('reports the name its write actually replaced when two renames race', async () => {
      // The audit event records "from" and "to". Without `FOR UPDATE`, B reads the name A has not
      // committed yet overwriting, and records a "from" that was already gone: a history that
      // skips a step. A holds its lock until B is observed waiting on it.
      const { workspace } = await makeTenant(db);
      const observer = new Client({ connectionString: database.url });
      await observer.connect();

      try {
        let releaseA!: () => void;
        const aMayCommit = new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        let aRenamed!: () => void;
        const aHasRenamed = new Promise<void>((resolve) => {
          aRenamed = resolve;
        });

        const a = withTransaction(db, async (tx) => {
          const result = await renameWorkspace(tx, workspace.id, 'From A');
          aRenamed();
          await aMayCommit;
          return result;
        });
        await aHasRenamed;
        const b = withTransaction(db, (tx) => renameWorkspace(tx, workspace.id, 'From B'));

        await waitForLockWait(observer);
        releaseA();

        expect(await a).toEqual({ previousName: 'Test Workspace' });
        expect(await b).toEqual({ previousName: 'From A' });
      } finally {
        await observer.end();
      }
    }, 30_000);

    it('renames nothing that does not exist', async () => {
      expect(await withTransaction(db, (tx) => renameWorkspace(tx, testId(), 'x'))).toBeNull();
    });

    it('keeps the membership row for the provisioned owner with explicit capabilities', async () => {
      const user = await makeUser(db);
      const outcome = await provision(user.id);
      const [membership] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.workspaceId, outcome?.workspaceId ?? ''));
      expect(membership).toMatchObject({ role: 'owner', canDownload: true, canInvite: true });
    });
  });
});

/**
 * Wait until some backend in this database is blocked on a lock — here, the racing insert
 * waiting on the unique index. Polls rather than sleeps, so the test is as fast as Postgres and
 * fails with a clear message instead of flaking when the machine is slow.
 */
async function waitForLockWait(observer: Client): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: string }>(
      `select count(*)::text as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(result.rows[0]?.waiting ?? '0') > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the racing transaction never blocked on the unique index');
}
