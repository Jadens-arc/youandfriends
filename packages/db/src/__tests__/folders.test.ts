import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { withTransaction } from '../transaction';
import {
  expectDatabaseError,
  makeFolder,
  makeTenant,
  makeUser,
  makeWorkspace,
  readFolder,
  SQLSTATE,
  testId,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING folder schema tests: ${reason}`);
}

describeWithDatabase('folder nesting', () => {
  let database: TestDatabase;
  let workspaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase('folders');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  beforeEach(async () => {
    const tenant = await makeTenant(database.db);
    workspaceId = tenant.workspace.id;
  });

  /** A chain of `depth` folders, each nested in the last. Returns them root-first. */
  async function makeChain(depth: number, prefix = 'level') {
    const chain = [];
    let parentId: string | null = null;
    for (let level = 0; level < depth; level += 1) {
      const folder = await makeFolder(database.db, workspaceId, `${prefix}-${level}`, parentId);
      chain.push(folder);
      parentId = folder.id;
    }
    return chain;
  }

  describe('materialized path', () => {
    it('gives a root folder a path of its own id', async () => {
      const root = await makeFolder(database.db, workspaceId, 'Root');
      expect(root.path).toBe(`/${root.id}/`);
      expect(root.depth).toBe(0);
    });

    it('builds a child path from its parent, to arbitrary depth', async () => {
      const chain = await makeChain(5);

      expect(chain).toHaveLength(5);
      for (const [level, folder] of chain.entries()) {
        const expected = `/${chain
          .slice(0, level + 1)
          .map((f) => f.id)
          .join('/')}/`;
        expect(folder.path).toBe(expected);
        expect(folder.depth).toBe(level);
      }
    });

    it('computes the path rather than trusting the caller', async () => {
      // A path that disagrees with parent_id would make every subtree query — and therefore
      // permission resolution in task `022` — return the wrong rows, silently.
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      const [child] = await database.db
        .execute(
          sql`
        insert into folders (id, workspace_id, parent_id, name, path)
        values (${testId()}, ${workspaceId}, ${parent.id}, 'Child', '/lies/')
        returning path
      `,
        )
        .then((result) => result.rows as { path: string }[]);

      expect(child?.path).not.toBe('/lies/');
      expect(child?.path).toContain(parent.id);
    });

    it('answers "everything under this folder" as a prefix scan', async () => {
      const chain = await makeChain(4);
      const mid = chain[1];
      if (!mid) throw new Error('chain too short');

      const { rows } = await database.db.execute(sql`
        select id from folders
         where workspace_id = ${workspaceId} and path like ${`${mid.path}%`}
         order by depth
      `);

      // The folder itself plus everything below it.
      expect(rows.map((row) => (row as { id: string }).id)).toEqual(
        chain.slice(1).map((folder) => folder.id),
      );
    });
  });

  describe('moving a folder', () => {
    it('rewrites the entire subtree, not just the folder moved', async () => {
      // Written before the trigger existed, per the task notes: a move that updates only the
      // moved row leaves every descendant pointing at an ancestor chain that no longer holds.
      const chain = await makeChain(5);
      const [, , mid] = chain;
      const newHome = await makeFolder(database.db, workspaceId, 'New home');
      if (!mid) throw new Error('chain too short');

      await database.db.execute(
        sql`update folders set parent_id = ${newHome.id} where id = ${mid.id}`,
      );

      const moved = await readFolder(database.db, mid.id);
      expect(moved.path).toBe(`${newHome.path}${mid.id}/`);
      expect(moved.depth).toBe(1);

      for (const [offset, descendant] of chain.slice(3).entries()) {
        const after = await readFolder(database.db, descendant.id);
        expect(after.path.startsWith(moved.path)).toBe(true);
        expect(after.depth).toBe(2 + offset);
      }
    });

    it('leaves folders outside the subtree alone', async () => {
      const chain = await makeChain(3);
      const bystander = await makeFolder(database.db, workspaceId, 'Bystander');
      const newHome = await makeFolder(database.db, workspaceId, 'New home');
      const mid = chain[1];
      if (!mid) throw new Error('chain too short');

      await database.db.execute(
        sql`update folders set parent_id = ${newHome.id} where id = ${mid.id}`,
      );

      expect((await readFolder(database.db, bystander.id)).path).toBe(bystander.path);
    });

    it('moves the whole subtree or none of it', async () => {
      const chain = await makeChain(4);
      const newHome = await makeFolder(database.db, workspaceId, 'New home');
      const mid = chain[1];
      const deepest = chain[3];
      if (!mid || !deepest) throw new Error('chain too short');

      // The move and a deliberate failure in one transaction. A subtree left half-moved is
      // the worst outcome available here: some descendants reachable, some orphaned.
      await expect(
        withTransaction(database.db, async (tx) => {
          await tx.execute(sql`update folders set parent_id = ${newHome.id} where id = ${mid.id}`);
          throw new Error('deliberate');
        }),
      ).rejects.toThrow();

      expect((await readFolder(database.db, mid.id)).path).toBe(mid.path);
      expect((await readFolder(database.db, deepest.id)).path).toBe(deepest.path);
    });

    it('promotes a folder to the root', async () => {
      const chain = await makeChain(3);
      const mid = chain[1];
      const leaf = chain[2];
      if (!mid || !leaf) throw new Error('chain too short');

      await database.db.execute(sql`update folders set parent_id = null where id = ${mid.id}`);

      expect((await readFolder(database.db, mid.id)).path).toBe(`/${mid.id}/`);
      expect((await readFolder(database.db, leaf.id)).path).toBe(`/${mid.id}/${leaf.id}/`);
    });
  });

  describe('cycles', () => {
    it('refuses to make a folder its own parent', async () => {
      const folder = await makeFolder(database.db, workspaceId, 'Self');

      await expectDatabaseError(
        database.db.execute(
          sql`update folders set parent_id = ${folder.id} where id = ${folder.id}`,
        ),
        SQLSTATE.checkViolation,
        /own descendant/,
      );
    });

    it('refuses to nest a folder under its own child', async () => {
      const chain = await makeChain(2);
      const [root, child] = chain;
      if (!root || !child) throw new Error('chain too short');

      await expectDatabaseError(
        database.db.execute(sql`update folders set parent_id = ${child.id} where id = ${root.id}`),
        SQLSTATE.checkViolation,
        /own descendant/,
      );
    });

    it('refuses to nest a folder under a distant descendant', async () => {
      const chain = await makeChain(5);
      const [root] = chain;
      const deepest = chain[4];
      if (!root || !deepest) throw new Error('chain too short');

      await expectDatabaseError(
        database.db.execute(
          sql`update folders set parent_id = ${deepest.id} where id = ${root.id}`,
        ),
        SQLSTATE.checkViolation,
        /own descendant/,
      );
    });

    it('leaves the tree untouched after a rejected move', async () => {
      const chain = await makeChain(3);
      const [root, , leaf] = chain;
      if (!root || !leaf) throw new Error('chain too short');

      await expect(
        database.db.execute(sql`update folders set parent_id = ${leaf.id} where id = ${root.id}`),
      ).rejects.toThrow();

      expect((await readFolder(database.db, root.id)).path).toBe(root.path);
      expect((await readFolder(database.db, leaf.id)).path).toBe(leaf.path);
    });
  });

  describe('tenant boundary', () => {
    it('refuses a parent from another workspace', async () => {
      // Otherwise one tenant's folder sits inside another's tree, and every subtree query in
      // the product carries it across the boundary (THREAT_MODEL T1).
      const otherUser = await makeUser(database.db);
      const otherWorkspace = await makeWorkspace(database.db, otherUser.id);
      const foreign = await makeFolder(database.db, otherWorkspace.id, 'Theirs');

      await expectDatabaseError(
        makeFolder(database.db, workspaceId, 'Ours', foreign.id),
        SQLSTATE.checkViolation,
        /another workspace/,
      );
    });

    it('refuses a parent that does not exist', async () => {
      await expectDatabaseError(
        makeFolder(database.db, workspaceId, 'Orphan', testId()),
        SQLSTATE.foreignKeyViolation,
        /does not exist/,
      );
    });
  });

  describe('naming', () => {
    it('refuses two folders with the same name under one parent', async () => {
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      await makeFolder(database.db, workspaceId, 'Demos', parent.id);

      await expectDatabaseError(
        makeFolder(database.db, workspaceId, 'Demos', parent.id),
        SQLSTATE.uniqueViolation,
        /folders_parent_name_key/,
      );
    });

    it('refuses two root folders with the same name', async () => {
      // Postgres treats NULLs as distinct in a unique index, so the root case needs its own
      // partial index — without it, unlimited identical root folders.
      await makeFolder(database.db, workspaceId, 'Demos');
      await expectDatabaseError(
        makeFolder(database.db, workspaceId, 'Demos'),
        SQLSTATE.uniqueViolation,
        /folders_root_name_key/,
      );
    });

    it('allows the same name in different parents', async () => {
      const a = await makeFolder(database.db, workspaceId, 'A');
      const b = await makeFolder(database.db, workspaceId, 'B');

      await expect(makeFolder(database.db, workspaceId, 'Demos', a.id)).resolves.toBeDefined();
      await expect(makeFolder(database.db, workspaceId, 'Demos', b.id)).resolves.toBeDefined();
    });
  });
});
