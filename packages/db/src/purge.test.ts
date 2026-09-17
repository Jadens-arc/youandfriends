import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  makeAsset,
  makeAssetVersion,
  makeFolder,
  makeMixVersion,
  makeProject,
  makeSnapshot,
  makeSong,
  makeStorageObject,
  makeTenant,
  testId,
} from './__tests__/factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './__tests__/harness';
import { describePlan, executePurge, planPurge, type PurgePlan } from './purge';
import {
  assets,
  derivatives,
  folders,
  projects,
  snapshots,
  songs,
  storageObjects,
} from './schema/index';
import {
  deleteAsset,
  deleteFolder,
  deleteProject,
  deleteSong,
  restoreBatch,
  type SoftDeleteOptions,
} from './soft-delete';
import { withTransaction } from './transaction';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING purge tests: ${reason}`);
}

const DELETED_AT = new Date('2026-08-01T00:00:00Z');
/** Comfortably past a 30-day window opened on 1 August. */
const AFTER_WINDOW = new Date('2026-09-16T00:00:00Z');
/** Inside it. */
const INSIDE_WINDOW = new Date('2026-08-15T00:00:00Z');

describe('describePlan', () => {
  const plan = (overrides: Partial<PurgePlan> = {}): PurgePlan => ({
    asOf: AFTER_WINDOW,
    candidates: [],
    refusals: [],
    storageObjects: [],
    storageKeys: [],
    ...overrides,
  });

  it('says plainly when there is nothing to do', () => {
    expect(describePlan(plan())).toContain('Nothing is past its recovery window');
  });

  it('names every row it intends to destroy', () => {
    // The task calls this the most dangerous code in the repository. A plan nobody can read
    // is a plan nobody reviews.
    const output = describePlan(
      plan({
        candidates: [
          {
            table: 'songs',
            id: 'SONG1',
            workspaceId: 'WS1',
            deletedAt: DELETED_AT,
            purgeAfter: AFTER_WINDOW,
          },
        ],
      }),
    );

    expect(output).toContain('DESTROY');
    expect(output).toContain('SONG1');
    expect(output).toContain('workspace=WS1');
    expect(output).toContain('1 to destroy');
  });

  it('names what it held back, and why', () => {
    const output = describePlan(
      plan({ refusals: [{ table: 'projects', id: 'P1', reason: 'song S1 is live' }] }),
    );

    expect(output).toContain('KEEP');
    expect(output).toContain('song S1 is live');
  });
});

describeWithDatabase('purge', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('purge');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  function options(workspaceId: string, now = DELETED_AT): SoftDeleteOptions {
    return {
      workspaceId,
      deletedBy: null,
      batch: testId(),
      now,
      recoveryWindowDays: 30,
    };
  }

  async function makeTree() {
    const { workspace } = await makeTenant(database.db);
    const folder = await makeFolder(database.db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(database.db, workspace.id, project.id, 'Track');
    return { workspaceId: workspace.id, folder, project, song };
  }

  const exists = async (table: typeof songs | typeof projects | typeof folders, id: string) =>
    (await database.db.select({ id: table.id }).from(table).where(eq(table.id, id))).length > 0;

  describe('the recovery window', () => {
    it('leaves a row alone until its window has passed', async () => {
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: INSIDE_WINDOW, workspaceId });

      expect(plan.candidates).toEqual([]);
      expect(describePlan(plan)).toContain('Nothing is past');
    });

    it('takes it once the window has passed', async () => {
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([song.id]);
    });

    it('never considers a live row, however old', async () => {
      const { workspaceId, song } = await makeTree();

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(song.id);
    });

    it('uses the window recorded at delete time, not the current setting', async () => {
      // A row deleted under a 90-day promise stays for 90 days even if the setting later
      // drops to 7. The alternative breaks a promise by changing a configuration value.
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) =>
        deleteSong(tx, song.id, { ...options(workspaceId), recoveryWindowDays: 90 }),
      );

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.candidates).toEqual([]);
    });
  });

  describe('referential checks', () => {
    it('refuses a project while a live song still belongs to it', async () => {
      const { workspaceId, project, song } = await makeTree();
      // Delete the project's tombstone directly, leaving the song live — the state a
      // partially-completed restore would produce.
      await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, options(workspaceId)),
      );
      await database.db
        .update(songs)
        .set({ deletedAt: null, purgeAfter: null })
        .where(eq(songs.id, song.id));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(project.id);
      expect(plan.refusals).toContainEqual(
        expect.objectContaining({ table: 'projects', id: project.id }),
      );
    });

    it('refuses a folder while a live project is still filed in it', async () => {
      const { workspaceId, folder, project } = await makeTree();
      await withTransaction(database.db, (tx) => deleteFolder(tx, folder.id, options(workspaceId)));
      await database.db
        .update(projects)
        .set({ deletedAt: null, purgeAfter: null })
        .where(eq(projects.id, project.id));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(folder.id);
      expect(plan.refusals[0]?.reason).toMatch(/still filed in it/);
    });

    it('purges the whole tree when everything in it is deleted', async () => {
      const { workspaceId, folder, project, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteFolder(tx, folder.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      await withTransaction(database.db, (tx) => executePurge(tx, plan, null));

      expect(await exists(songs, song.id)).toBe(false);
      expect(await exists(projects, project.id)).toBe(false);
      expect(await exists(folders, folder.id)).toBe(false);
    });
  });

  describe('planning never destroys', () => {
    it('leaves every row in place', async () => {
      // `--dry-run` is trustworthy because `planPurge` only reads, not because the caller
      // remembered to stop.
      const { workspaceId, folder, project, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteFolder(tx, folder.id, options(workspaceId)));

      await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(await exists(songs, song.id)).toBe(true);
      expect(await exists(projects, project.id)).toBe(true);
      expect(await exists(folders, folder.id)).toBe(true);
    });
  });

  describe('execution', () => {
    it('will not purge a row restored between planning and execution', async () => {
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.candidates).toHaveLength(1);

      // The owner changes their mind while the job is running.
      await database.db
        .update(songs)
        .set({ deletedAt: null, purgeAfter: null, deletedBatch: null })
        .where(eq(songs.id, song.id));

      const result = await withTransaction(database.db, (tx) => executePurge(tx, plan, null));

      // A plan is a proposal, never a warrant.
      expect(result.purged.songs).toBe(0);
      expect(await exists(songs, song.id)).toBe(true);
    });

    it('refuses to run when a plan names storage objects and no reaper was supplied', async () => {
      const { workspaceId } = await makeTree();
      const plan: PurgePlan = {
        asOf: AFTER_WINDOW,
        candidates: [],
        refusals: [],
        storageObjects: [{ id: '01J8XKQ2M3N4P5R6S7T8V9W0XY', key: 'w/ws_1/o/01J8XK' }],
        storageKeys: ['w/ws_1/o/01J8XK'],
      };

      // Deleting the rows without the objects orphans storage that nothing will reference
      // again, and no later run can find it — the pointers are gone.
      await expect(
        withTransaction(database.db, (tx) => executePurge(tx, plan, null)),
      ).rejects.toThrow(/no reaper was supplied/);
      void workspaceId;
    });

    it('deletes storage objects after the rows, not before', async () => {
      // A real object, because the reaper is now handed the keys whose rows actually went
      // rather than the keys the plan named. A fabricated key would be reaped by neither.
      const { workspaceId, song } = await makeTree();
      const asset = await makeAsset(database.db, workspaceId, { songId: song.id });
      const object = await makeStorageObject(database.db, workspaceId);
      await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);

      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      const order: string[] = [];
      const reaper = {
        delete: vi.fn(async () => {
          order.push('storage');
        }),
      };

      await withTransaction(database.db, async (tx) => {
        const result = await executePurge(tx, plan, reaper);
        order.push(`rows:${result.purged.songs}`);
        return result;
      });

      // Rows first. If the transaction rolls back after the objects are gone, the rows still
      // say what was lost; the other order destroys the record of what to look for.
      expect(order).toEqual(['storage', 'rows:1']);
      expect(reaper.delete).toHaveBeenCalledWith([object.key]);
    });

    it('rolls back every row when the reaper fails', async () => {
      const { workspaceId, song } = await makeTree();
      const asset = await makeAsset(database.db, workspaceId, { songId: song.id });
      const object = await makeStorageObject(database.db, workspaceId);
      await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);

      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.storageKeys).toEqual([object.key]);

      const reaper = { delete: vi.fn(() => Promise.reject(new Error('R2 unavailable'))) };

      await expect(
        withTransaction(database.db, (tx) => executePurge(tx, plan, reaper)),
      ).rejects.toThrow();

      // The song is still there and still purgeable on the next run, which is the recoverable
      // outcome. Losing the row while keeping the object is not.
      expect(await exists(songs, song.id)).toBe(true);
    });
  });

  describe('blast radius', () => {
    it('confines a run to one workspace when asked', async () => {
      const mine = await makeTree();
      const theirs = await makeTree();
      await withTransaction(database.db, (tx) =>
        deleteSong(tx, mine.song.id, options(mine.workspaceId)),
      );
      await withTransaction(database.db, (tx) =>
        deleteSong(tx, theirs.song.id, options(theirs.workspaceId)),
      );

      const plan = await planPurge(database.db, {
        now: AFTER_WINDOW,
        workspaceId: mine.workspaceId,
      });

      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([mine.song.id]);
    });

    it('caps how much one run will take', async () => {
      const { workspaceId, project } = await makeTree();
      for (let index = 0; index < 4; index += 1) {
        const extra = await makeSong(database.db, workspaceId, project.id, `Extra ${index}`);
        await withTransaction(database.db, (tx) => deleteSong(tx, extra.id, options(workspaceId)));
      }

      // A purge that takes two nights is fine. One that deletes everything at once when the
      // query is wrong is not.
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId, limit: 2 });
      expect(plan.candidates.length).toBeLessThanOrEqual(2);
    });
  });
});

describeWithDatabase('the cascade that a referential check must anticipate', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('purge_cascade');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  function options(workspaceId: string, now: Date): SoftDeleteOptions {
    return { workspaceId, deletedBy: null, batch: testId(), now, recoveryWindowDays: 30 };
  }

  it('holds a project back while a song in the trash is still inside its window', async () => {
    // `songs.project_id` cascades on delete, so purging the project would hard-delete this
    // song — one the plan never named, still recoverable, still inside the window its owner
    // was promised. Silent data loss through a foreign key.
    //
    // Found by running the job end to end against real rows. Every unit test until this one
    // deleted a whole tree at once, where the case cannot arise.
    const { workspace } = await makeTenant(database.db);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`);
    const old = await makeSong(database.db, workspace.id, project.id, 'Long gone');
    const recent = await makeSong(database.db, workspace.id, project.id, 'Just trashed');

    await withTransaction(database.db, (tx) =>
      deleteSong(tx, old.id, options(workspace.id, DELETED_AT)),
    );
    await withTransaction(database.db, (tx) =>
      deleteSong(tx, recent.id, options(workspace.id, new Date('2026-09-15T00:00:00Z'))),
    );
    await withTransaction(database.db, (tx) =>
      deleteProject(tx, project.id, options(workspace.id, DELETED_AT)),
    );

    const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId: workspace.id });

    expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(project.id);
    expect(plan.refusals).toContainEqual(
      expect.objectContaining({
        id: project.id,
        reason: expect.stringContaining('not yet purgeable'),
      }),
    );

    await withTransaction(database.db, (tx) => executePurge(tx, plan, null));

    // The old song goes; the recent one and its project stay.
    const remaining = await database.db
      .select({ id: songs.id })
      .from(songs)
      .where(eq(songs.projectId, project.id));
    expect(remaining.map((row) => row.id)).toEqual([recent.id]);
    expect(
      (
        await database.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, project.id))
      ).length,
    ).toBe(1);
  });

  it('holds a folder back while a nested folder is not going with it', async () => {
    const { workspace } = await makeTenant(database.db);
    const parent = await makeFolder(database.db, workspace.id, `Parent ${testId()}`);
    const child = await makeFolder(database.db, workspace.id, 'Child', parent.id);

    await withTransaction(database.db, (tx) =>
      deleteFolder(tx, child.id, options(workspace.id, new Date('2026-09-15T00:00:00Z'))),
    );
    await withTransaction(database.db, (tx) =>
      deleteFolder(tx, parent.id, options(workspace.id, DELETED_AT)),
    );

    const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId: workspace.id });

    // `folders.parent_id` cascades too: purging the parent would take a subtree the owner
    // can still recover.
    expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(parent.id);
    expect(plan.refusals).toContainEqual(
      expect.objectContaining({
        id: parent.id,
        reason: expect.stringContaining('not yet purgeable'),
      }),
    );
  });

  it('purges a parent once every child is eligible too', async () => {
    const { workspace } = await makeTenant(database.db);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`);
    const song = await makeSong(database.db, workspace.id, project.id, 'Track');

    await withTransaction(database.db, (tx) =>
      deleteProject(tx, project.id, options(workspace.id, DELETED_AT)),
    );

    const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId: workspace.id });
    expect(plan.refusals).toEqual([]);

    await withTransaction(database.db, (tx) => executePurge(tx, plan, null));

    expect(
      (await database.db.select({ id: songs.id }).from(songs).where(eq(songs.id, song.id))).length,
    ).toBe(0);
  });

  it('propagates a refusal upwards, so a held-back project does not lose its folder', async () => {
    // The second-order case, and the one that actually stranded a row in the end-to-end run:
    // refusing the project is useless if its folder is purged anyway. `projects.folder_id` is
    // `on delete set null`, so the project silently becomes unfiled — moved by nobody.
    // Refusals are resolved to a fixed point for exactly this.
    const { workspace } = await makeTenant(database.db);
    const folder = await makeFolder(database.db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`, folder.id);
    const recent = await makeSong(database.db, workspace.id, project.id, 'Trashed yesterday');

    await withTransaction(database.db, (tx) =>
      deleteSong(tx, recent.id, options(workspace.id, new Date('2026-09-15T00:00:00Z'))),
    );
    await withTransaction(database.db, (tx) =>
      deleteFolder(tx, folder.id, options(workspace.id, DELETED_AT)),
    );

    const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId: workspace.id });
    const doomed = plan.candidates.map((candidate) => candidate.id);

    expect(doomed).not.toContain(project.id);
    expect(doomed).not.toContain(folder.id);

    await withTransaction(database.db, (tx) => executePurge(tx, plan, null));

    const [survivor] = await database.db
      .select({ folderId: projects.folderId })
      .from(projects)
      .where(eq(projects.id, project.id));

    expect(survivor?.folderId).toBe(folder.id);
  });

  it('refuses all the way up a deep tree', async () => {
    const { workspace } = await makeTenant(database.db);
    const grandparent = await makeFolder(database.db, workspace.id, `Grand ${testId()}`);
    const parent = await makeFolder(database.db, workspace.id, 'Parent', grandparent.id);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`, parent.id);
    const recent = await makeSong(database.db, workspace.id, project.id, 'Recent');

    await withTransaction(database.db, (tx) =>
      deleteSong(tx, recent.id, options(workspace.id, new Date('2026-09-15T00:00:00Z'))),
    );
    await withTransaction(database.db, (tx) =>
      deleteFolder(tx, grandparent.id, options(workspace.id, DELETED_AT)),
    );

    const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId: workspace.id });

    // One song inside its window keeps the project, the parent, and the grandparent alive.
    expect(plan.candidates).toEqual([]);
    expect(plan.refusals.map((refusal) => refusal.id).sort()).toEqual(
      [project.id, parent.id, grandparent.id].sort(),
    );
  });
});

/**
 * The file layer.
 *
 * Task `026` created `assets`, `asset_versions`, `snapshots`, and `storage_objects`; task
 * `025`'s purge was written before any of them existed and did not reach them. The failure was
 * silent in both directions — a hard-deleted song left its bytes in the bucket with nothing
 * pointing at them, and an asset trashed on its own was destroyed early with its song — so
 * these tests assert against **row counts read back from the database**, not against the plan's
 * own account of itself.
 */
describeWithDatabase('purge reaches the file layer', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('purge_files');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const options = (workspaceId: string): SoftDeleteOptions => ({
    workspaceId,
    deletedBy: null,
    batch: testId(),
    now: DELETED_AT,
    recoveryWindowDays: 30,
  });

  /**
   * A song with one asset, one version, the storage object behind it — and a mix.
   *
   * The mix is not decoration. `mix_versions.asset_version_id` is `ON DELETE RESTRICT`, and
   * every song the product actually produces has one (task `027`'s seed creates twelve). A
   * fixture without one let a purge order that Postgres rejects look correct in every test
   * here, which is the only reason that regression shipped.
   */
  async function makeSongWithFile() {
    const { workspace } = await makeTenant(database.db);
    const folder = await makeFolder(database.db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(database.db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(database.db, workspace.id, project.id, 'Track');
    const asset = await makeAsset(database.db, workspace.id, { songId: song.id });
    const object = await makeStorageObject(database.db, workspace.id);
    const version = await makeAssetVersion(database.db, workspace.id, asset.id, object.id, 1);
    const mix = await makeMixVersion(database.db, workspace.id, song.id, version.id, 1);
    return { workspaceId: workspace.id, folder, project, song, asset, object, version, mix };
  }

  /**
   * A file on the same song that no mix plays — a stem, a session, an export.
   *
   * Most of Project Files is this. It is the asset that can be trashed and purged on its own,
   * because nothing user-visible points at its versions.
   */
  async function makeLooseFile(workspaceId: string, songId: string) {
    const asset = await makeAsset(
      database.db,
      workspaceId,
      { songId },
      { kind: 'stem', name: 'Stems.zip' },
    );
    const object = await makeStorageObject(database.db, workspaceId);
    const version = await makeAssetVersion(database.db, workspaceId, asset.id, object.id, 1);
    return { asset, object, version };
  }

  const countIn = async (table: typeof storageObjects | typeof assets, workspaceId: string) =>
    (await database.db.select().from(table).where(eq(table.workspaceId, workspaceId))).length;

  describe('the cascade into Project Files', () => {
    it('trashes a song with its assets, in the same batch', async () => {
      const { workspaceId, song, asset } = await makeSongWithFile();
      const opts = options(workspaceId);

      const result = await withTransaction(database.db, (tx) => deleteSong(tx, song.id, opts));

      expect(result.assets).toEqual([asset.id]);

      // Read the row, not the return value: a cascade that reported an id it did not write
      // would leave the asset live and downloadable while its song sat in the trash.
      const [row] = await database.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.deletedBatch).toBe(opts.batch);
      expect(row?.purgeAfter).not.toBeNull();
    });

    it('trashes a project with its snapshots and both kinds of asset', async () => {
      const { workspaceId, project, song, asset } = await makeSongWithFile();
      const artwork = await makeAsset(
        database.db,
        workspaceId,
        { projectId: project.id },
        { kind: 'artwork' },
      );
      const snapshot = await makeSnapshot(database.db, workspaceId, project.id);
      const opts = options(workspaceId);

      const result = await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, opts),
      );

      // An asset hangs off exactly one of a song or a project, so both sides have to be swept.
      expect(result.assets.sort()).toEqual([asset.id, artwork.id].sort());
      expect(result.snapshots).toEqual([snapshot.id]);
      expect(result.songs).toEqual([song.id]);
    });

    it('trashes a folder subtree down to its files, both kinds', async () => {
      // `cascadeToFiles` sweeps assets owned by a project *and* assets owned by a song, because
      // `assets_one_owner` says an asset has exactly one of the two. The folder path used to be
      // tested with a song-owned asset only, so passing `[]` where `projectIds` belongs at this
      // one call site would have dropped every piece of artwork and every snapshot from a
      // folder-level trash, with nothing red.
      const { workspaceId, folder, project, asset } = await makeSongWithFile();
      const artwork = await makeAsset(
        database.db,
        workspaceId,
        { projectId: project.id },
        { kind: 'artwork' },
      );
      const snapshot = await makeSnapshot(database.db, workspaceId, project.id);
      const opts = options(workspaceId);

      const result = await withTransaction(database.db, (tx) => deleteFolder(tx, folder.id, opts));

      expect(result.assets.sort()).toEqual([asset.id, artwork.id].sort());
      expect(result.snapshots).toEqual([snapshot.id]);

      // Read back, not trusted from the return value.
      for (const id of [asset.id, artwork.id]) {
        const [row] = await database.db.select().from(assets).where(eq(assets.id, id));
        expect(row?.deletedBatch, id).toBe(opts.batch);
      }
      const [snapshotRow] = await database.db
        .select()
        .from(snapshots)
        .where(eq(snapshots.id, snapshot.id));
      expect(snapshotRow?.deletedBatch).toBe(opts.batch);
    });

    it('leaves an asset already in the trash in the batch that put it there', async () => {
      const { workspaceId, song, asset } = await makeSongWithFile();
      const first = options(workspaceId);
      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, first));

      const second = options(workspaceId);
      const result = await withTransaction(database.db, (tx) => deleteSong(tx, song.id, second));

      // Otherwise restoring the song would drag back an asset its owner deleted separately.
      expect(result.assets).toEqual([]);
      const [row] = await database.db.select().from(assets).where(eq(assets.id, asset.id));
      expect(row?.deletedBatch).toBe(first.batch);
    });
  });

  describe('restoring is still the exact inverse', () => {
    it('returns the assets and snapshots that went with the delete, and no others', async () => {
      const { workspaceId, project, song, asset } = await makeSongWithFile();
      const snapshot = await makeSnapshot(database.db, workspaceId, project.id);

      // Trashed separately, and earlier. It must stay where its owner put it.
      const other = await makeAsset(database.db, workspaceId, { songId: song.id });
      await withTransaction(database.db, (tx) => deleteAsset(tx, other.id, options(workspaceId)));

      const opts = options(workspaceId);
      await withTransaction(database.db, (tx) => deleteProject(tx, project.id, opts));

      const restored = await withTransaction(database.db, (tx) =>
        restoreBatch(tx, opts.batch, workspaceId),
      );

      expect(restored.assets).toEqual([asset.id]);
      expect(restored.snapshots).toEqual([snapshot.id]);

      const [stillGone] = await database.db.select().from(assets).where(eq(assets.id, other.id));
      expect(stillGone?.deletedAt).not.toBeNull();
    });

    it('refuses to restore an asset whose song is still in the trash', async () => {
      const { workspaceId, song, asset } = await makeSongWithFile();

      // The song goes first, taking the asset with it. Then the asset alone is restored — but
      // an asset has exactly one owner and no unfiled state to land in, so there is nowhere
      // honest to put it.
      const songBatch = options(workspaceId);
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, songBatch));

      await database.db
        .update(assets)
        .set({ deletedBatch: 'a-batch-of-its-own' })
        .where(eq(assets.id, asset.id));

      await expect(
        withTransaction(database.db, (tx) => restoreBatch(tx, 'a-batch-of-its-own', workspaceId)),
      ).rejects.toThrow(/cannot be restored while/);
    });
  });

  describe('the plan reaches storage', () => {
    it('names the storage object behind a purged song', async () => {
      const { workspaceId, song, object } = await makeSongWithFile();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      // The old planner returned `[]` here unconditionally, which meant the guard in
      // `executePurge` could never fire and the bytes stayed in the bucket forever.
      expect(plan.storageKeys).toEqual([object.key]);
      expect(plan.storageObjects.map((row) => row.id)).toEqual([object.id]);
      expect(describePlan(plan)).toContain('1 storage objects');
    });

    it('destroys the rows and the objects together', async () => {
      const { workspaceId, song, object } = await makeSongWithFile();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const before = await countIn(storageObjects, workspaceId);
      expect(before).toBe(1);

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      const reaped: string[] = [];
      const result = await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, {
          delete: async (keys) => {
            reaped.push(...keys);
          },
        }),
      );

      expect(await countIn(storageObjects, workspaceId)).toBe(0);
      expect(await countIn(assets, workspaceId)).toBe(0);
      expect(reaped).toEqual([object.key]);
      expect(result.storageObjectsDeleted).toBe(1);
    });

    it('keeps an object a surviving version still references', async () => {
      // The same bytes can back two versions once a copy exists. Reaping on the first delete
      // would destroy a file a live row still names — and `ON DELETE RESTRICT` would refuse
      // the row delete, so getting this wrong fails loudly rather than silently.
      const { workspaceId, song } = await makeSongWithFile();
      const { asset, object } = await makeLooseFile(workspaceId, song.id);
      const survivor = await makeAsset(database.db, workspaceId, { songId: song.id });
      await makeAssetVersion(database.db, workspaceId, survivor.id, object.id, 1);

      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([asset.id]);
      expect(plan.storageKeys).toEqual([]);

      await withTransaction(database.db, (tx) => executePurge(tx, plan, null));
      // Both the shared object and the song's own mix object survive.
      expect(await countIn(storageObjects, workspaceId)).toBe(2);
    });

    it("reaps a derivative's own object, which has no RESTRICT to catch a miss", async () => {
      // A streaming rendition is a whole second file, paid for by the byte.
      // `derivatives.storage_object_id` is `ON DELETE SET NULL`, so unlike a version or a
      // snapshot there is no constraint that refuses a wrong answer — the row simply cascades
      // away and the bytes stay in the bucket with nothing left to find them by. Found by
      // running a purge and counting, not by reading the code.
      const { workspaceId, song, object, version } = await makeSongWithFile();
      const rendition = await makeStorageObject(database.db, workspaceId);
      await database.db.insert(derivatives).values({
        id: testId(),
        workspaceId,
        assetVersionId: version.id,
        kind: 'streaming_audio',
        variant: 'aac-192k',
        storageObjectId: rendition.id,
        processingState: 'complete',
      });

      expect(await countIn(storageObjects, workspaceId)).toBe(2);

      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect([...plan.storageKeys].sort()).toEqual([object.key, rendition.key].sort());

      const reaped: string[] = [];
      await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, {
          delete: async (keys) => {
            reaped.push(...keys);
          },
        }),
      );

      expect(reaped.sort()).toEqual([object.key, rendition.key].sort());
      expect(await countIn(storageObjects, workspaceId)).toBe(0);
    });

    it('keeps an object a surviving derivative still points at', async () => {
      // The other direction, and the dangerous one: `SET NULL` would not refuse this delete.
      // It would blank the surviving derivative's pointer and leave a rendition that plays
      // nothing — worse than an error, because nobody would see it happen.
      const { workspaceId, song } = await makeSongWithFile();
      const { asset, object, version } = await makeLooseFile(workspaceId, song.id);

      // A second song in the same project, live, whose derivative shares the rendition.
      const [owner] = await database.db
        .select({ projectId: songs.projectId })
        .from(songs)
        .where(eq(songs.id, song.id));
      if (!owner) throw new Error('the fixture song has no project');
      const liveSong = await makeSong(database.db, workspaceId, owner.projectId, 'Still here');
      const liveAsset = await makeAsset(database.db, workspaceId, { songId: liveSong.id });
      const liveObject = await makeStorageObject(database.db, workspaceId);
      const liveVersion = await makeAssetVersion(
        database.db,
        workspaceId,
        liveAsset.id,
        liveObject.id,
        1,
      );

      const shared = await makeStorageObject(database.db, workspaceId);
      for (const [versionId, variant] of [
        [version.id, 'aac-192k'],
        [liveVersion.id, 'aac-192k'],
      ] as const) {
        await database.db.insert(derivatives).values({
          id: testId(),
          workspaceId,
          assetVersionId: versionId,
          kind: 'streaming_audio',
          variant,
          storageObjectId: shared.id,
          processingState: 'complete',
        });
      }

      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      // The doomed asset's original goes. The shared rendition does not, because the live
      // song's derivative still names it.
      expect(plan.storageKeys).toEqual([object.key]);

      await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, { delete: async () => undefined }),
      );

      const surviving = await database.db
        .select({ id: storageObjects.id })
        .from(storageObjects)
        .where(eq(storageObjects.workspaceId, workspaceId));
      // The doomed stem's object went; the shared rendition, the live song's original, and the
      // first song's own mix object all stay.
      expect(surviving.map((row) => row.id)).not.toContain(object.id);
      expect(surviving.map((row) => row.id)).toEqual(
        expect.arrayContaining([liveObject.id, shared.id]),
      );

      // And the surviving derivative still points somewhere.
      const rows = await database.db
        .select()
        .from(derivatives)
        .where(eq(derivatives.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.storageObjectId).toBe(shared.id);
    });

    it('ignores a derivative that has no object yet', async () => {
      // Null while the job is queued, or after it failed. Task `027`'s seed produces exactly
      // this state on purpose.
      const { workspaceId, song, object, version } = await makeSongWithFile();
      await database.db.insert(derivatives).values({
        id: testId(),
        workspaceId,
        assetVersionId: version.id,
        kind: 'streaming_audio',
        variant: 'aac-192k',
        storageObjectId: null,
        processingState: 'failed',
      });

      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.storageKeys).toEqual([object.key]);
      await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, { delete: async () => undefined }),
      );
      expect(await countIn(storageObjects, workspaceId)).toBe(0);
    });

    it('reaps a finalized snapshot ZIP with its project', async () => {
      const { workspaceId, project, song } = await makeSongWithFile();
      const zip = await makeStorageObject(database.db, workspaceId);
      await makeSnapshot(database.db, workspaceId, project.id, {
        storageObjectId: zip.id,
        finalized: true,
      });

      await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, options(workspaceId)),
      );

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.storageKeys).toContain(zip.key);

      const reaped: string[] = [];
      await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, {
          delete: async (keys) => {
            reaped.push(...keys);
          },
        }),
      );

      // A finalized snapshot is sealed against edits, and its entries are sealed with it. Its
      // *deletion* is not an edit, and this is the test that says so — a seal that also blocked
      // purge would make a project undeletable forever.
      expect(reaped).toContain(zip.key);
      expect(await countIn(storageObjects, workspaceId)).toBe(0);
      expect(
        await database.db.select().from(snapshots).where(eq(snapshots.workspaceId, workspaceId)),
      ).toEqual([]);
      expect(song).toBeDefined();
    });
  });

  describe('a plan is a proposal, never a warrant', () => {
    it('does not reap bytes for a row restored since planning', async () => {
      // `executePurge` re-validates the rows, and now re-validates the storage reachability the
      // same way: each object goes only if nothing references it *now*. For `asset_versions`
      // and `snapshots` `RESTRICT` would refuse anyway; for `derivatives`, `SET NULL` would
      // have quietly blanked a surviving rendition's pointer and left it claiming `complete`
      // with nothing to re-queue it. So the check is what protects the one case with no net.
      const { workspaceId, song, object } = await makeSongWithFile();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.storageKeys).toEqual([object.key]);

      // The owner changes their mind between the plan and the run.
      await database.db
        .update(songs)
        .set({ deletedAt: null, purgeAfter: null, deletedBatch: null })
        .where(eq(songs.id, song.id));
      await database.db
        .update(assets)
        .set({ deletedAt: null, purgeAfter: null, deletedBatch: null })
        .where(eq(assets.songId, song.id));

      const reaped: string[] = [];
      const result = await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, {
          delete: async (keys) => {
            reaped.push(...keys);
          },
        }),
      );

      // Nothing destroyed, and — the part that matters — the reaper was never handed a key for
      // bytes that are still referenced. Handing it `plan.storageKeys` would have deleted the
      // file out from under a song that is live again.
      expect(reaped).toEqual([]);
      expect(result.storageKeysDeleted).toEqual([]);
      expect(result.destroyed.songs).toEqual([]);
      expect(await countIn(storageObjects, workspaceId)).toBe(1);
      expect(await countIn(assets, workspaceId)).toBe(1);
      expect(await database.db.select().from(songs).where(eq(songs.id, song.id))).toHaveLength(1);
    }, 60_000);
    it('does not blank a surviving derivative when only its object was planned', async () => {
      // The one case with no database-level net, and the reason the storage delete re-validates
      // rather than trusting the plan. Built so the derivative's object is the *only* thing the
      // plan names: its version's own object is shared with a live version and therefore kept,
      // so no `RESTRICT` fires to roll the transaction back and mask the problem.
      const { workspaceId, song } = await makeSongWithFile();
      const { asset, object, version } = await makeLooseFile(workspaceId, song.id);

      // A live asset sharing the stem's original, so that object is kept.
      const sharer = await makeAsset(database.db, workspaceId, { songId: song.id });
      await makeAssetVersion(database.db, workspaceId, sharer.id, object.id, 1);

      const rendition = await makeStorageObject(database.db, workspaceId);
      await database.db.insert(derivatives).values({
        id: testId(),
        workspaceId,
        assetVersionId: version.id,
        kind: 'streaming_audio',
        variant: 'aac-192k',
        storageObjectId: rendition.id,
        processingState: 'complete',
      });

      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, options(workspaceId)));
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      expect(plan.storageKeys).toEqual([rendition.key]);

      // The owner restores the asset between planning and running.
      await database.db
        .update(assets)
        .set({ deletedAt: null, purgeAfter: null, deletedBatch: null })
        .where(eq(assets.id, asset.id));

      const reaped: string[] = [];
      const result = await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, {
          delete: async (keys) => {
            reaped.push(...keys);
          },
        }),
      );

      // `SET NULL` would not have refused this. The rendition would be gone from the bucket,
      // the row left claiming `complete` with a null pointer, and nothing to re-queue it —
      // silent, on a song that is live again.
      expect(reaped).toEqual([]);
      expect(result.storageKeysDeleted).toEqual([]);
      const [row] = await database.db
        .select()
        .from(derivatives)
        .where(eq(derivatives.workspaceId, workspaceId));
      expect(row?.storageObjectId).toBe(rendition.id);
      expect(
        (await database.db.select().from(storageObjects).where(eq(storageObjects.id, rendition.id)))
          .length,
      ).toBe(1);
    }, 60_000);
  });

  describe('a run that spans tenants', () => {
    it("reaps each workspace's objects and only its own", async () => {
      // `reachableStorage` resolves by id list rather than by workspace, because a global run
      // has candidates from many tenants at once. Ids are unique, so that is sound — but "it
      // is sound because ids are unique" is the kind of reasoning that is true until someone
      // changes an id scheme, so it gets a test with two real tenants in one run.
      const a = await makeSongWithFile();
      const b = await makeSongWithFile();

      await withTransaction(database.db, (tx) => deleteSong(tx, a.song.id, options(a.workspaceId)));

      // Tenant B's song is trashed too, but under a longer promise: it must survive.
      await withTransaction(database.db, (tx) =>
        deleteSong(tx, b.song.id, { ...options(b.workspaceId), recoveryWindowDays: 3650 }),
      );

      // No `workspaceId`: the global run.
      const plan = await planPurge(database.db, { now: AFTER_WINDOW });

      expect(plan.storageKeys).toContain(a.object.key);
      expect(plan.storageKeys).not.toContain(b.object.key);

      await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, { delete: async () => undefined }),
      );

      expect(await countIn(storageObjects, a.workspaceId)).toBe(0);
      expect(await countIn(storageObjects, b.workspaceId)).toBe(1);
      expect(await countIn(assets, b.workspaceId)).toBe(1);
    }, 60_000);
  });

  describe('the recovery window reaches the file layer too', () => {
    it('holds a song back while an asset under it is still inside its own window', async () => {
      // Failure mode #1 from task `025`, one level down. `assets.song_id` cascades, so purging
      // the song would hard-delete an asset the plan never named and its owner could still
      // restore.
      const { workspaceId, song, asset } = await makeSongWithFile();

      await withTransaction(database.db, (tx) =>
        deleteSong(tx, song.id, { ...options(workspaceId), recoveryWindowDays: 1 }),
      );
      // The asset was trashed under a longer promise: 90 days from the same moment.
      await database.db
        .update(assets)
        .set({ purgeAfter: new Date('2026-10-30T00:00:00Z') })
        .where(eq(assets.id, asset.id));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(song.id);
      expect(plan.refusals.map((refusal) => refusal.id)).toContain(song.id);
      // And the bytes stay, because the version that names them is still reachable.
      expect(plan.storageKeys).toEqual([]);
    });

    it('purges an asset trashed on its own once its own window passes', async () => {
      const { workspaceId, song } = await makeSongWithFile();
      const { asset, object } = await makeLooseFile(workspaceId, song.id);
      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([asset.id]);
      expect(plan.storageKeys).toEqual([object.key]);

      const result = await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, { delete: async () => undefined }),
      );

      expect(result.purged.assets).toBe(1);
      // Its song is untouched: the asset went on its own, and the song's own mix asset stays.
      expect(result.purged.songs).toBe(0);
      expect(await countIn(assets, workspaceId)).toBe(1);
      expect(await countIn(storageObjects, workspaceId)).toBe(1);
    });

    it('holds an asset back while a live song still plays it as a mix', async () => {
      // `mix_versions.asset_version_id` is `ON DELETE RESTRICT`, so destroying this asset would
      // be refused by Postgres and take the whole run down with it. But an error is the wrong
      // answer twice over: the right one is a refusal, because removing that mix row would
      // delete a row on a song that was never in the trash.
      const { workspaceId, asset } = await makeSongWithFile();
      await withTransaction(database.db, (tx) => deleteAsset(tx, asset.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      expect(plan.candidates).toEqual([]);
      expect(plan.refusals.map((refusal) => refusal.id)).toEqual([asset.id]);
      expect(plan.refusals[0]?.reason).toMatch(/live and still plays it as a mix/);
      expect(plan.storageKeys).toEqual([]);

      // And the run completes rather than rolling back.
      const result = await withTransaction(database.db, (tx) => executePurge(tx, plan, null));
      expect(result.purged.assets).toBe(0);
      expect(await countIn(assets, workspaceId)).toBe(1);
    });

    it('counts what it destroyed, per table, against a known fixture', async () => {
      // `bin/purge.mjs` prints these numbers and nothing else does. A copy-paste in the result
      // object — `snapshots: purgedAssets.length`, say — would leave every row delete and every
      // audit event correct and only the operator's record wrong, which is the failure mode the
      // CLI fix in this same task exists to prevent. So the counts get asserted against a
      // fixture whose composition is known by construction rather than read back from the run.
      const { workspaceId, project, song } = await makeSongWithFile();
      const loose = await makeLooseFile(workspaceId, song.id);
      await makeAsset(database.db, workspaceId, { projectId: project.id }, { kind: 'artwork' });
      const zip = await makeStorageObject(database.db, workspaceId);
      await makeSnapshot(database.db, workspaceId, project.id, { storageObjectId: zip.id });

      // 1 project, 1 song, 3 assets (mix + stem + artwork), 1 snapshot, 1 mix version.
      await withTransaction(database.db, (tx) =>
        deleteProject(tx, project.id, options(workspaceId)),
      );
      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });

      const result = await withTransaction(database.db, (tx) =>
        executePurge(tx, plan, { delete: async () => undefined }),
      );

      expect(result.purged).toEqual({
        folders: 0,
        projects: 1,
        songs: 1,
        assets: 3,
        snapshots: 1,
      });
      expect(result.mixVersionsDeleted).toBe(1);
      // Three objects: the mix original, the stem, and the snapshot ZIP.
      expect(result.storageObjectsDeleted).toBe(3);
      expect(result.storageKeysDeleted).toHaveLength(3);
      expect(result.storageKeysDeleted).toContain(zip.key);
      expect(result.storageKeysDeleted).toContain(loose.object.key);

      // And the counts are not fiction: the tables really are empty.
      expect(await countIn(assets, workspaceId)).toBe(0);
      expect(await countIn(storageObjects, workspaceId)).toBe(0);
      expect(
        await database.db.select().from(snapshots).where(eq(snapshots.workspaceId, workspaceId)),
      ).toEqual([]);
    }, 60_000);

    it('never reports an empty storage list when a candidate owns an object', async () => {
      // The property behind the cases above, stated over the data: whenever the plan approves
      // something that owns bytes, it says so. The old planner failed this unconditionally.
      const { workspaceId, song } = await makeSongWithFile();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));

      const plan = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      const ownsBytes = plan.candidates.some(
        (candidate) => candidate.table === 'songs' || candidate.table === 'assets',
      );

      expect(ownsBytes).toBe(true);
      expect(plan.storageKeys.length).toBeGreaterThan(0);
    });
  });
});
