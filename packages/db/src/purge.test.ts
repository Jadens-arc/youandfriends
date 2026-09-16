import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFolder, makeProject, makeSong, makeTenant, testId } from './__tests__/factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './__tests__/harness';
import { describePlan, executePurge, planPurge, type PurgePlan } from './purge';
import { folders, projects, songs } from './schema/index';
import { deleteFolder, deleteProject, deleteSong, type SoftDeleteOptions } from './soft-delete';
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
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const planned = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      const plan: PurgePlan = { ...planned, storageKeys: ['w/ws_1/o/01J8XK'] };

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
      expect(reaper.delete).toHaveBeenCalledWith(['w/ws_1/o/01J8XK']);
    });

    it('rolls back every row when the reaper fails', async () => {
      const { workspaceId, song } = await makeTree();
      await withTransaction(database.db, (tx) => deleteSong(tx, song.id, options(workspaceId)));
      const planned = await planPurge(database.db, { now: AFTER_WINDOW, workspaceId });
      const plan: PurgePlan = { ...planned, storageKeys: ['w/ws_1/o/01J8XK'] };

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
