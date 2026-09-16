import { type WorkspaceId } from '@youandfriends/contracts';
import { auditEvents, songs, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditIdForTests } from '../audit';
import { deleteEntity, restoreEntity, runPurge, type LifecycleContext } from '../lifecycle';
import { memberSubject } from '../subjects';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING lifecycle tests: ${reason}`);
}

const DELETED_AT = new Date('2026-08-01T00:00:00Z');
const AFTER_WINDOW = new Date('2026-09-16T00:00:00Z');

describeWithDatabase('audited lifecycle', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('lifecycle');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function makeTree() {
    const { user, workspace } = await makeTenant(db);
    const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const first = await makeSong(db, workspace.id, project.id, 'First');
    const second = await makeSong(db, workspace.id, project.id, 'Second');

    const context: LifecycleContext = {
      workspaceId: workspace.id as WorkspaceId,
      actor: memberSubject(user.id as never),
      recoveryWindowDays: 30,
      now: () => DELETED_AT,
      newId: auditIdForTests,
    };

    return { user, workspace, folder, project, first, second, context };
  }

  const eventsFor = (workspaceId: string) =>
    db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));

  it('audits every row a cascade touched, not just the one named', async () => {
    const { workspace, folder, project, first, second, context } = await makeTree();

    await deleteEntity(db, context, 'folder', folder.id);

    const events = await eventsFor(workspace.id);
    const targets = events.map((event) => event.targetId).sort();

    // Deleting a folder can remove forty songs. "Who deleted this song" has to be answerable
    // for each of them; one folder-level event leaves thirty-nine questions unanswered.
    expect(targets).toEqual([folder.id, project.id, first.id, second.id].sort());
    expect(new Set(events.map((event) => event.action))).toEqual(
      new Set(['folder.deleted', 'project.deleted', 'song.deleted']),
    );
  });

  it('records the batch, so the audit row points at the restore that undoes it', async () => {
    const { workspace, first, context } = await makeTree();

    const result = await deleteEntity(db, context, 'song', first.id);
    const [event] = await eventsFor(workspace.id);

    expect((event?.metadata as { batch?: string }).batch).toBe(result.batch);
  });

  it('audits a restore as its own event per row', async () => {
    const { workspace, project, first, second, context } = await makeTree();

    const deleted = await deleteEntity(db, context, 'project', project.id);
    await restoreEntity(db, context, deleted.batch);

    const events = await eventsFor(workspace.id);
    const restores = events.filter((event) => event.action.endsWith('.restored'));

    expect(restores.map((event) => event.targetId).sort()).toEqual(
      [project.id, first.id, second.id].sort(),
    );
  });

  it('leaves no audit event when the delete rolls back', async () => {
    const { workspace, context } = await makeTree();

    // A delete of something that does not exist marks nothing, so there is nothing to audit.
    await deleteEntity(db, context, 'song', testId());

    expect(await eventsFor(workspace.id)).toEqual([]);
  });

  it('records the actor on every row', async () => {
    const { user, workspace, folder, context } = await makeTree();

    await deleteEntity(db, context, 'folder', folder.id);

    const events = await eventsFor(workspace.id);
    expect(events.every((event) => event.actorId === user.id)).toBe(true);
    expect(events.every((event) => event.actorKind === 'member')).toBe(true);
  });

  describe('purge', () => {
    it('destroys nothing on a dry run, and returns a readable plan', async () => {
      const { workspace, folder, first, context } = await makeTree();
      await deleteEntity(db, context, 'folder', folder.id);

      const run = await runPurge(db, context, {
        now: AFTER_WINDOW,
        workspaceId: workspace.id,
        dryRun: true,
      });

      expect(run.result).toBeNull();
      expect(run.plan).toContain('DESTROY');
      // A dry run never opens a write transaction at all, so it cannot destroy anything even
      // if the flag were computed wrongly.
      const survivors = await db.select().from(songs).where(eq(songs.id, first.id));
      expect(survivors).toHaveLength(1);
    });

    it('audits each purged row, which is the only record it ever existed', async () => {
      const { workspace, folder, first, context } = await makeTree();
      await deleteEntity(db, context, 'folder', folder.id);
      const before = (await eventsFor(workspace.id)).length;

      await runPurge(db, context, {
        now: AFTER_WINDOW,
        workspaceId: workspace.id,
        dryRun: false,
      });

      const events = await eventsFor(workspace.id);
      const purgeEvents = events.filter(
        (event) => (event.metadata as { purged?: boolean }).purged === true,
      );

      expect(events.length).toBeGreaterThan(before);
      expect(purgeEvents.map((event) => event.targetId)).toContain(first.id);
      expect(await db.select().from(songs).where(eq(songs.id, first.id))).toEqual([]);
    });

    it('keeps the purge audit events after the rows are gone', async () => {
      const { workspace, folder, context } = await makeTree();
      await deleteEntity(db, context, 'folder', folder.id);
      await runPurge(db, context, {
        now: AFTER_WINDOW,
        workspaceId: workspace.id,
        dryRun: false,
      });

      // The table is append-only, and the rows it describes no longer exist. This is the
      // whole value of an audit log that outlives its subjects.
      const events = await eventsFor(workspace.id);
      expect(events.length).toBeGreaterThan(0);
    });
  });
});

describeWithDatabase('scoped reads and the trash', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('lifecycle_scoped');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function trashOne() {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`);
    const kept = await makeSong(db, workspace.id, project.id, 'Kept');
    const trashed = await makeSong(db, workspace.id, project.id, 'Trashed');

    const context: LifecycleContext = {
      workspaceId: workspace.id as WorkspaceId,
      actor: memberSubject(user.id as never),
      recoveryWindowDays: 30,
      now: () => DELETED_AT,
      newId: auditIdForTests,
    };
    await deleteEntity(db, context, 'song', trashed.id);

    const { scopedQuery } = await import('../scoped-query');
    const scoped = await scopedQuery(
      db,
      memberSubject(user.id as never),
      workspace.id as WorkspaceId,
    );
    return { scoped, kept, trashed };
  }

  it('excludes the trash by default', async () => {
    const { scoped, kept } = await trashOne();
    const { songs: songsTable } = await import('@youandfriends/db');

    // Not a flag the caller has to remember. A forgotten filter shows deleted work as though
    // it were live, which is the bug that makes "deleted" meaningless.
    const rows = await scoped.many(songsTable);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
    expect(await scoped.count(songsTable)).toBe(1);
  });

  it('returns only the trash when asked for it', async () => {
    const { scoped, trashed, kept } = await trashOne();
    const { songs: songsTable } = await import('@youandfriends/db');

    const rows = await scoped.many(songsTable, undefined, { lifecycle: 'deleted' });
    expect(rows.map((row) => row.id)).toEqual([trashed.id]);
    // And only the trash: the trash view is not "everything, sorted differently".
    expect(rows.map((row) => row.id)).not.toContain(kept.id);
  });

  it('returns both when asked for both', async () => {
    const { scoped } = await trashOne();
    const { songs: songsTable } = await import('@youandfriends/db');

    expect(await scoped.count(songsTable, undefined, { lifecycle: 'all' })).toBe(2);
  });

  it('hides a trashed row from a lookup by id', async () => {
    const { scoped, trashed } = await trashOne();
    const { songs: songsTable } = await import('@youandfriends/db');
    const { eq: equals } = await import('drizzle-orm');

    // Knowing the id is not a way around the default.
    expect(await scoped.one(songsTable, equals(songsTable.id, trashed.id))).toBeNull();
  });

  it('leaves a table without the columns alone', async () => {
    const { user, workspace } = await makeTenant(db);
    const { permissionGrants } = await import('@youandfriends/db');
    const { scopedQuery } = await import('../scoped-query');

    const scoped = await scopedQuery(
      db,
      memberSubject(user.id as never),
      workspace.id as WorkspaceId,
    );

    // `permission_grants` is not deleted, it is revoked. Asking for a lifecycle it has no
    // columns for is satisfied rather than refused.
    await expect(scoped.count(permissionGrants, undefined, { lifecycle: 'deleted' })).resolves.toBe(
      0,
    );
  });
});
