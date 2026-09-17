import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assets, folders, projects, songs } from '../schema/index';
import {
  deleteAsset,
  deleteFolder,
  deleteProject,
  deleteSong,
  purgeAfterFrom,
  restoreBatch,
  RestoreBlockedError,
  type SoftDeleteOptions,
} from '../soft-delete';
import { withTransaction } from '../transaction';
import { makeAsset, makeFolder, makeProject, makeSong, makeTenant, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING soft-delete tests: ${reason}`);
}

const NOW = new Date('2026-09-16T12:00:00Z');

describe('purgeAfterFrom', () => {
  it('adds the recovery window to the delete time', () => {
    expect(purgeAfterFrom(NOW, 30)).toEqual(new Date('2026-10-16T12:00:00Z'));
  });

  it('handles a month boundary without arithmetic of its own', () => {
    expect(purgeAfterFrom(new Date('2026-01-31T00:00:00Z'), 1)).toEqual(
      new Date('2026-02-01T00:00:00Z'),
    );
  });

  it('is computed at delete time, so changing the setting cannot reach backwards', () => {
    // The whole point of the column. If purge recomputed the window, lowering the setting
    // would destroy things a user was told they could still recover.
    const deletedUnder30 = purgeAfterFrom(NOW, 30);
    const deletedUnder7 = purgeAfterFrom(NOW, 7);
    expect(deletedUnder30).not.toEqual(deletedUnder7);
  });
});

describeWithDatabase('soft deletion', () => {
  let database: TestDatabase;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase('soft_delete');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  function options(overrides: Partial<SoftDeleteOptions> = {}): SoftDeleteOptions {
    return {
      workspaceId,
      deletedBy: userId,
      batch: testId(),
      now: NOW,
      recoveryWindowDays: 30,
      ...overrides,
    };
  }

  /** A folder tree with a project and two songs, freshly made for one test. */
  async function makeTree() {
    const tenant = await makeTenant(database.db);
    workspaceId = tenant.workspace.id;
    userId = tenant.user.id;

    const parent = await makeFolder(database.db, workspaceId, `Parent ${testId()}`);
    const child = await makeFolder(database.db, workspaceId, 'Album', parent.id);
    const project = await makeProject(database.db, workspaceId, `Project ${testId()}`, child.id);
    const first = await makeSong(database.db, workspaceId, project.id, 'First');
    const second = await makeSong(database.db, workspaceId, project.id, 'Second');

    return { parent, child, project, first, second };
  }

  const readSong = async (id: string) =>
    (await database.db.select().from(songs).where(eq(songs.id, id)))[0];
  const readProject = async (id: string) =>
    (await database.db.select().from(projects).where(eq(projects.id, id)))[0];
  const readFolder = async (id: string) =>
    (await database.db.select().from(folders).where(eq(folders.id, id)))[0];

  describe('a song', () => {
    it('is marked, not removed', async () => {
      const { first } = await makeTree();
      const opts = options();

      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, opts));

      const row = await readSong(first.id);
      // Trash is a real place with real contents, not a euphemism for gone.
      expect(row).toBeDefined();
      expect(row?.deletedAt).toEqual(NOW);
      expect(row?.deletedBy).toBe(userId);
      expect(row?.deletedBatch).toBe(opts.batch);
      expect(row?.purgeAfter).toEqual(new Date('2026-10-16T12:00:00Z'));
    });

    it('cannot be deleted twice into a new batch', async () => {
      const { first } = await makeTree();
      const firstDelete = options();
      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, firstDelete));

      const second = await withTransaction(database.db, (tx) =>
        deleteSong(tx, first.id, options()),
      );

      // Re-deleting must not overwrite the batch, or the original restore loses its member.
      expect(second.songs).toEqual([]);
      expect((await readSong(first.id))?.deletedBatch).toBe(firstDelete.batch);
    });

    it('ignores an asset in another workspace', async () => {
      // The tenant boundary on the newest entry point. Songs and batches have had this since
      // task `025`; `deleteAsset` arrived with `028` and needs its own, because a workspace
      // filter is the kind of thing that is present until someone refactors the query.
      const { first } = await makeTree();
      const asset = await makeAsset(database.db, first.workspaceId, { songId: first.id });
      const other = await makeTenant(database.db);

      const result = await withTransaction(database.db, (tx) =>
        deleteAsset(tx, asset.id, options({ workspaceId: other.workspace.id })),
      );

      expect(result.assets).toEqual([]);
      const [row] = await database.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row?.deletedAt).toBeNull();
    });

    it('ignores a song in another workspace', async () => {
      const { first } = await makeTree();
      const other = await makeTenant(database.db);

      const result = await withTransaction(database.db, (tx) =>
        deleteSong(tx, first.id, options({ workspaceId: other.workspace.id })),
      );

      expect(result.songs).toEqual([]);
      expect((await readSong(first.id))?.deletedAt).toBeNull();
    });
  });

  describe('a project', () => {
    it('takes its songs with it', async () => {
      const { project, first, second } = await makeTree();
      const opts = options();

      const result = await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, opts),
      );

      expect(result.projects).toEqual([project.id]);
      expect(result.songs.sort()).toEqual([first.id, second.id].sort());
      expect((await readSong(first.id))?.deletedBatch).toBe(opts.batch);
    });

    it('leaves a song already in the trash in its own batch', async () => {
      // The case the batch column exists for. A song trashed on Tuesday and a project
      // deleted on Friday are two different decisions, and restoring the project must not
      // undo the first one.
      const { project, first, second } = await makeTree();
      const songDelete = options();
      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, songDelete));

      const projectDelete = options();
      const result = await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, projectDelete),
      );

      expect(result.songs).toEqual([second.id]);
      expect((await readSong(first.id))?.deletedBatch).toBe(songDelete.batch);
    });
  });

  describe('a folder', () => {
    it('takes the whole subtree, and everything filed anywhere in it', async () => {
      const { parent, child, project, first, second } = await makeTree();
      const opts = options();

      const result = await withTransaction(database.db, (tx) => deleteFolder(tx, parent.id, opts));

      expect(result.folders.sort()).toEqual([parent.id, child.id].sort());
      expect(result.projects).toEqual([project.id]);
      expect(result.songs.sort()).toEqual([first.id, second.id].sort());
    });

    it('leaves a sibling subtree alone', async () => {
      const { parent } = await makeTree();
      const sibling = await makeFolder(database.db, workspaceId, `Sibling ${testId()}`);
      const siblingProject = await makeProject(
        database.db,
        workspaceId,
        `Safe ${testId()}`,
        sibling.id,
      );

      await withTransaction(database.db, (tx) => deleteFolder(tx, parent.id, options()));

      expect((await readFolder(sibling.id))?.deletedAt).toBeNull();
      expect((await readProject(siblingProject.id))?.deletedAt).toBeNull();
    });

    it('does nothing for a folder that is already deleted', async () => {
      const { parent } = await makeTree();
      await withTransaction(database.db, (tx) => deleteFolder(tx, parent.id, options()));

      const second = await withTransaction(database.db, (tx) =>
        deleteFolder(tx, parent.id, options()),
      );

      expect(second).toMatchObject({ folders: [], projects: [], songs: [] });
    });
  });

  describe('restore is the exact inverse of delete', () => {
    it('returns precisely the rows that delete removed', async () => {
      const { parent, child, project, first, second } = await makeTree();
      const opts = options();

      const deleted = await withTransaction(database.db, (tx) => deleteFolder(tx, parent.id, opts));
      const restored = await withTransaction(database.db, (tx) =>
        restoreBatch(tx, opts.batch, workspaceId),
      );

      // The round trip the task notes call for: delete and restore must be symmetric, or
      // restoring a project silently leaves songs deleted.
      expect(restored.folders.sort()).toEqual(deleted.folders.sort());
      expect(restored.projects.sort()).toEqual(deleted.projects.sort());
      expect(restored.songs.sort()).toEqual(deleted.songs.sort());

      for (const id of [parent.id, child.id]) {
        expect((await readFolder(id))?.deletedAt).toBeNull();
      }
      expect((await readProject(project.id))?.deletedAt).toBeNull();
      for (const id of [first.id, second.id]) {
        expect((await readSong(id))?.deletedAt).toBeNull();
      }
    });

    it('clears every tombstone column, not just deletedAt', async () => {
      const { first } = await makeTree();
      const opts = options();
      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, opts));
      await withTransaction(database.db, (tx) => restoreBatch(tx, opts.batch, workspaceId));

      const row = await readSong(first.id);
      // A stale `purge_after` on a live row is a scheduled deletion nobody can see.
      expect(row).toMatchObject({
        deletedAt: null,
        deletedBy: null,
        purgeAfter: null,
        deletedBatch: null,
      });
    });

    it('does not resurrect a row that was already in the trash', async () => {
      const { project, first, second } = await makeTree();
      const songDelete = options();
      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, songDelete));

      const projectDelete = options();
      await withTransaction(database.db, (tx) => deleteProject(tx, project.id, projectDelete));
      await withTransaction(database.db, (tx) =>
        restoreBatch(tx, projectDelete.batch, workspaceId),
      );

      // Restoring the project brings back what it took. The song its owner trashed first
      // stays where they put it.
      expect((await readSong(second.id))?.deletedAt).toBeNull();
      expect((await readSong(first.id))?.deletedAt).toEqual(NOW);
    });

    it('restores a project to the root when its folder is still deleted', async () => {
      const { child, project } = await makeTree();
      const folderDelete = options();
      await withTransaction(database.db, (tx) => deleteFolder(tx, child.id, folderDelete));

      // Restore only the project, by re-deleting it into its own batch first.
      await withTransaction(database.db, (tx) => restoreBatch(tx, folderDelete.batch, workspaceId));
      const projectDelete = options();
      await withTransaction(database.db, (tx) => deleteProject(tx, project.id, projectDelete));
      await withTransaction(database.db, (tx) => deleteFolder(tx, child.id, options()));
      await withTransaction(database.db, (tx) =>
        restoreBatch(tx, projectDelete.batch, workspaceId),
      );

      // Unfiled is a state the product already has, so this is a place the user can find it
      // rather than a pointer at something invisible.
      const row = await readProject(project.id);
      expect(row?.deletedAt).toBeNull();
      expect(row?.folderId).toBeNull();
    });

    it('refuses to restore a song whose project is still in the trash', async () => {
      const { project, first } = await makeTree();
      const songDelete = options();
      await withTransaction(database.db, (tx) => deleteSong(tx, first.id, songDelete));
      await withTransaction(database.db, (tx) => deleteProject(tx, project.id, options()));

      // `project_id` is not null and there is nowhere honest to put it. Restoring the
      // project silently would be a bigger action than the one asked for.
      const error = await withTransaction(database.db, (tx) =>
        restoreBatch(tx, songDelete.batch, workspaceId),
      ).catch((caught: unknown) => caught);

      // A typed error, so a caller can tell "you must restore the parent first" apart from
      // a database failure and say so to the person, rather than showing them a stack.
      expect((error as { cause?: unknown }).cause).toBeInstanceOf(RestoreBlockedError);
      expect((error as Error).message).toMatch(/Restore the project first/);

      expect((await readSong(first.id))?.deletedAt).toEqual(NOW);
    });

    it('restores nothing for an unknown batch', async () => {
      await makeTree();
      const result = await withTransaction(database.db, (tx) =>
        restoreBatch(tx, testId(), workspaceId),
      );
      expect(result).toMatchObject({ folders: [], projects: [], songs: [] });
    });

    it('will not restore another workspace’s batch', async () => {
      const { parent } = await makeTree();
      const opts = options();
      await withTransaction(database.db, (tx) => deleteFolder(tx, parent.id, opts));

      const other = await makeTenant(database.db);
      const result = await withTransaction(database.db, (tx) =>
        restoreBatch(tx, opts.batch, other.workspace.id),
      );

      expect(result.folders).toEqual([]);
      expect((await readFolder(parent.id))?.deletedAt).toEqual(NOW);
    });
  });

  describe('transactional behaviour', () => {
    it('leaves nothing marked when the delete rolls back', async () => {
      const { parent, project, first } = await makeTree();

      await expect(
        withTransaction(database.db, async (tx) => {
          await deleteFolder(tx, parent.id, options());
          throw new Error('deliberate');
        }),
      ).rejects.toThrow();

      // A half-applied cascade is the state that loses work: some rows invisible, some not.
      expect((await readFolder(parent.id))?.deletedAt).toBeNull();
      expect((await readProject(project.id))?.deletedAt).toBeNull();
      expect((await readSong(first.id))?.deletedAt).toBeNull();
    });
  });

  describe('the folder triggers still hold over tombstones', () => {
    it('keeps a deleted folder’s path correct when its parent moves', async () => {
      // Soft deletion must not quietly opt rows out of the invariants task `021` enforces:
      // a restored folder with a stale path would be filed under a parent it no longer has.
      const { parent, child } = await makeTree();
      const newHome = await makeFolder(database.db, workspaceId, `Elsewhere ${testId()}`);

      await withTransaction(database.db, (tx) => deleteFolder(tx, child.id, options()));
      await database.db.execute(
        sql`update folders set parent_id = ${newHome.id} where id = ${parent.id}`,
      );

      const moved = await readFolder(child.id);
      expect(moved?.path.startsWith(`${newHome.path}${parent.id}/`)).toBe(true);
      expect(moved?.deletedAt).toEqual(NOW);
    });
  });
});
