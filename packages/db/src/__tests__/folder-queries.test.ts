import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createFolder,
  getFolder,
  listWorkspaceFolders,
  moveFolder,
  renameFolder,
} from '../queries/folders';
import { withTransaction } from '../transaction';
import { makeFolder, makeTenant, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING folder query tests: ${reason}`);
}

describeWithDatabase('folder queries', () => {
  let database: TestDatabase;
  let workspaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase('folder-queries');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  beforeEach(async () => {
    const tenant = await makeTenant(database.db);
    workspaceId = tenant.workspace.id;
  });

  describe('listWorkspaceFolders', () => {
    it('lists only live folders in this workspace', async () => {
      const kept = await makeFolder(database.db, workspaceId, 'Kept');
      const other = await makeTenant(database.db);
      await makeFolder(database.db, other.workspace.id, 'Theirs');

      const rows = await listWorkspaceFolders(database.db, workspaceId);

      expect(rows.map((row) => row.id)).toEqual([kept.id]);
    });

    it('excludes soft-deleted folders', async () => {
      const folder = await makeFolder(database.db, workspaceId, 'Gone');
      // Soft delete's own mechanics are exercised end-to-end elsewhere (task `025`); here only
      // the read side — a tombstone must not appear in a workspace listing — is under test.
      await database.db.execute(sql`update folders set deleted_at = now() where id = ${folder.id}`);

      const rows = await listWorkspaceFolders(database.db, workspaceId);
      expect(rows.map((row) => row.id)).not.toContain(folder.id);
    });
  });

  describe('getFolder', () => {
    it('returns null for a folder in another workspace', async () => {
      const other = await makeTenant(database.db);
      const foreign = await makeFolder(database.db, other.workspace.id, 'Theirs');

      expect(await getFolder(database.db, workspaceId, foreign.id)).toBeNull();
    });

    it('returns the row when it exists in this workspace', async () => {
      const folder = await makeFolder(database.db, workspaceId, 'Mine');
      const row = await getFolder(database.db, workspaceId, folder.id);
      expect(row?.id).toBe(folder.id);
    });
  });

  describe('createFolder', () => {
    it('creates a root folder', async () => {
      const result = await withTransaction(database.db, (tx) =>
        createFolder(tx, { id: testId(), workspaceId, parentId: null, name: 'Demos' }),
      );
      expect(result.ok).toBe(true);
    });

    it('reports name_conflict rather than throwing when two root folders collide', async () => {
      await makeFolder(database.db, workspaceId, 'Demos');

      const result = await withTransaction(database.db, (tx) =>
        createFolder(tx, { id: testId(), workspaceId, parentId: null, name: 'Demos' }),
      );

      expect(result).toEqual({ ok: false, reason: 'name_conflict' });
    });

    it('reports name_conflict for two same-named children of one parent', async () => {
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      await makeFolder(database.db, workspaceId, 'Mixes', parent.id);

      const result = await withTransaction(database.db, (tx) =>
        createFolder(tx, { id: testId(), workspaceId, parentId: parent.id, name: 'Mixes' }),
      );

      expect(result).toEqual({ ok: false, reason: 'name_conflict' });
    });

    it('reports invalid_parent for a parent in another workspace', async () => {
      const other = await makeTenant(database.db);
      const foreign = await makeFolder(database.db, other.workspace.id, 'Theirs');

      const result = await withTransaction(database.db, (tx) =>
        createFolder(tx, { id: testId(), workspaceId, parentId: foreign.id, name: 'Ours' }),
      );

      expect(result).toEqual({ ok: false, reason: 'invalid_parent' });
    });
  });

  describe('renameFolder', () => {
    it('renames in place', async () => {
      const folder = await makeFolder(database.db, workspaceId, 'Old name');

      const result = await withTransaction(database.db, (tx) =>
        renameFolder(tx, workspaceId, folder.id, 'New name'),
      );

      expect(result.ok).toBe(true);
      expect(await getFolder(database.db, workspaceId, folder.id)).toMatchObject({
        name: 'New name',
      });
    });

    it('reports not_found for a folder in another workspace', async () => {
      const other = await makeTenant(database.db);
      const foreign = await makeFolder(database.db, other.workspace.id, 'Theirs');

      const result = await withTransaction(database.db, (tx) =>
        renameFolder(tx, workspaceId, foreign.id, 'Stolen'),
      );

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('reports name_conflict renaming into a sibling collision', async () => {
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      await makeFolder(database.db, workspaceId, 'Mixes', parent.id);
      const other = await makeFolder(database.db, workspaceId, 'Masters', parent.id);

      const result = await withTransaction(database.db, (tx) =>
        renameFolder(tx, workspaceId, other.id, 'Mixes'),
      );

      expect(result).toEqual({ ok: false, reason: 'name_conflict' });
    });
  });

  describe('moveFolder', () => {
    it('moves a folder and rewrites its own path', async () => {
      const folder = await makeFolder(database.db, workspaceId, 'Movable');
      const newHome = await makeFolder(database.db, workspaceId, 'New home');

      const result = await withTransaction(database.db, (tx) =>
        moveFolder(tx, workspaceId, folder.id, newHome.id),
      );

      expect(result.ok).toBe(true);
      const moved = await getFolder(database.db, workspaceId, folder.id);
      expect(moved?.path).toBe(`${newHome.path}${folder.id}/`);
    });

    it('reports invalid_parent for a cycle', async () => {
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      const child = await makeFolder(database.db, workspaceId, 'Child', parent.id);

      const result = await withTransaction(database.db, (tx) =>
        moveFolder(tx, workspaceId, parent.id, child.id),
      );

      expect(result).toEqual({ ok: false, reason: 'invalid_parent' });
    });

    it('reports not_found for a folder in another workspace', async () => {
      const other = await makeTenant(database.db);
      const foreign = await makeFolder(database.db, other.workspace.id, 'Theirs');
      const newHome = await makeFolder(database.db, workspaceId, 'New home');

      const result = await withTransaction(database.db, (tx) =>
        moveFolder(tx, workspaceId, foreign.id, newHome.id),
      );

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('promotes a folder to root with a null parent', async () => {
      const parent = await makeFolder(database.db, workspaceId, 'Parent');
      const child = await makeFolder(database.db, workspaceId, 'Child', parent.id);

      const result = await withTransaction(database.db, (tx) =>
        moveFolder(tx, workspaceId, child.id, null),
      );

      expect(result.ok).toBe(true);
      const moved = await getFolder(database.db, workspaceId, child.id);
      expect(moved?.path).toBe(`/${child.id}/`);
    });
  });
});
