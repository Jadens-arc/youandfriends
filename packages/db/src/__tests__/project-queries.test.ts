import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  listContentActivityPage,
  listFavoritesOf,
  listRecentSongsPage,
  listSongsByIds,
  listWorkspaceProjects,
} from '../queries/projects';
import { folders, projects, songs, workspaceMemberships } from '../schema/index';
import {
  addMember,
  makeAuditEvent,
  makeFavorite,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  setUpdatedAt,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING project library query tests: ${reason}`);

/**
 * The project library's reads (task `041`), against a real database.
 *
 * These functions do no authorization — that is `packages/authz`'s job — so what is tested here
 * is that each one returns the right *candidates*: live rows only, this workspace only, with
 * each row's scope chain attached, and aggregates that are actually aggregated. The fixture
 * carries a second tenant with its own projects, songs, favourites and activity, so a missing
 * `workspace_id` filter has something to leak (CLAUDE.md §13, task `026`'s lesson).
 */
describeWithDatabase('project library queries', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('project-queries');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  /** A populated second tenant: every table these queries read has rows on the other side. */
  async function makeForeignTenant() {
    const db = database.db;
    const other = await makeTenant(db);
    const folder = await makeFolder(db, other.workspace.id, 'Theirs');
    const project = await makeProject(db, other.workspace.id, 'Their project', folder.id);
    const song = await makeSong(db, other.workspace.id, project.id, 'Their song');
    const colleague = await makeUser(db);
    await addMember(db, other.workspace.id, colleague.id, 'editor');
    await makeFavorite(db, other.workspace.id, other.user.id, 'song', song.id);
    await makeAuditEvent(db, {
      workspaceId: other.workspace.id,
      actorId: colleague.id,
      action: 'song.updated',
      targetType: 'song',
      targetId: song.id,
    });
    return { ...other, folder, project, song };
  }

  describe('listWorkspaceProjects', () => {
    it('counts only live songs, and takes last activity from the newest of them', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      await makeForeignTenant();
      const folder = await makeFolder(db, workspace.id, 'Albums');
      const filed = await makeProject(db, workspace.id, 'Filed', folder.id);
      const empty = await makeProject(db, workspace.id, 'Empty');

      const old = await makeSong(db, workspace.id, filed.id, 'Old');
      const fresh = await makeSong(db, workspace.id, filed.id, 'Fresh');
      const trashed = await makeSong(db, workspace.id, filed.id, 'Trashed');
      await setUpdatedAt(db, 'projects', filed.id, new Date('2026-01-01T00:00:00Z'));
      await setUpdatedAt(db, 'songs', old.id, new Date('2026-02-01T00:00:00Z'));
      await setUpdatedAt(db, 'songs', fresh.id, new Date('2026-03-01T00:00:00Z'));
      // Deleted, and the newest of all: it must neither be counted nor set the activity date.
      await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, trashed.id));
      await setUpdatedAt(db, 'songs', trashed.id, new Date('2026-04-01T00:00:00Z'));
      await setUpdatedAt(db, 'projects', empty.id, new Date('2026-05-01T00:00:00Z'));

      const rows = await listWorkspaceProjects(db, workspace.id);

      expect(rows.map((row) => row.name).sort()).toEqual(['Empty', 'Filed']);
      const filedRow = rows.find((row) => row.id === filed.id);
      expect(filedRow?.songCount).toBe(2);
      expect(filedRow?.lastActivityAt).toEqual(new Date('2026-03-01T00:00:00Z'));
      expect(filedRow?.folderPath).toBe(folder.path);
      const emptyRow = rows.find((row) => row.id === empty.id);
      expect(emptyRow?.songCount).toBe(0);
      expect(emptyRow?.folderPath).toBe('');
      // No songs: the project's own last change is its activity.
      expect(emptyRow?.lastActivityAt).toEqual(new Date('2026-05-01T00:00:00Z'));
    });

    it('leaves excluded songs out of both the count and the activity date', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const project = await makeProject(db, workspace.id, 'P');
      const seen = await makeSong(db, workspace.id, project.id, 'Seen');
      const hidden = await makeSong(db, workspace.id, project.id, 'Hidden');
      await setUpdatedAt(db, 'projects', project.id, new Date('2026-01-01T00:00:00Z'));
      await setUpdatedAt(db, 'songs', seen.id, new Date('2026-02-01T00:00:00Z'));
      await setUpdatedAt(db, 'songs', hidden.id, new Date('2026-03-01T00:00:00Z'));

      const [row] = await listWorkspaceProjects(db, workspace.id, [hidden.id]);
      expect(row?.songCount).toBe(1);
      expect(row?.lastActivityAt).toEqual(new Date('2026-02-01T00:00:00Z'));
    });

    it('leaves out deleted projects and another workspace’s projects', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const foreign = await makeForeignTenant();
      const kept = await makeProject(db, workspace.id, 'Kept');
      const gone = await makeProject(db, workspace.id, 'Gone');
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, gone.id));

      const rows = await listWorkspaceProjects(db, workspace.id);

      expect(rows.map((row) => row.id)).toEqual([kept.id]);
      expect(rows.some((row) => row.id === foreign.project.id)).toBe(false);
    });

    it('keeps a project’s folder path even when the folder itself is deleted', async () => {
      // The path is the project's scope chain. Dropping it would drop every folder grant — and
      // every folder deny — from that project's resolution.
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Archived');
      const project = await makeProject(db, workspace.id, 'Still here', folder.id);
      await db.update(folders).set({ deletedAt: new Date() }).where(eq(folders.id, folder.id));

      const [row] = await listWorkspaceProjects(db, workspace.id);
      expect(row?.id).toBe(project.id);
      expect(row?.folderPath).toBe(folder.path);
    });

    it('is one statement, however many projects there are', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      for (let index = 0; index < 30; index += 1) {
        const project = await makeProject(db, workspace.id, `Project ${index}`);
        await makeSong(db, workspace.id, project.id, 'A');
        await makeSong(db, workspace.id, project.id, 'B');
      }

      let statements = 0;
      const counting = new Proxy(db, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property === 'select' && typeof value === 'function') {
            return (...args: unknown[]) => {
              statements += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      });

      const rows = await listWorkspaceProjects(counting, workspace.id);
      expect(rows).toHaveLength(30);
      expect(rows.every((row) => row.songCount === 2)).toBe(true);
      // Two builders — the grouped song subquery and the outer select — sent as one statement.
      expect(statements).toBe(2);
    });
  });

  describe('listRecentSongsPage', () => {
    it('pages newest first, without skipping or repeating rows that share a timestamp', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      await makeForeignTenant();
      const folder = await makeFolder(db, workspace.id, 'F');
      const project = await makeProject(db, workspace.id, 'P', folder.id);
      const created = [];
      for (let index = 0; index < 7; index += 1) {
        created.push(await makeSong(db, workspace.id, project.id, `Song ${index}`));
      }
      // Five songs in the same microsecond — the case a millisecond `Date` cursor gets wrong —
      // and two distinct, older ones.
      await setUpdatedAt(
        db,
        'songs',
        created.slice(0, 5).map((song) => song.id),
        '2026-06-01 12:00:00.123456+00',
      );
      await setUpdatedAt(db, 'songs', created[5]?.id ?? '', '2026-06-01 12:00:00.123999+00');
      await setUpdatedAt(db, 'songs', created[6]?.id ?? '', new Date('2026-01-01T00:00:00Z'));
      const trashed = await makeSong(db, workspace.id, project.id, 'Trashed');
      await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, trashed.id));

      const seen: string[] = [];
      let cursor = null;
      let pages = 0;
      do {
        const page = await listRecentSongsPage(db, workspace.id, 2, cursor);
        seen.push(...page.items.map((song) => song.id));
        cursor = page.next;
        pages += 1;
      } while (cursor !== null && pages < 10);

      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(created.map((song) => song.id).sort());
      expect(seen[0]).toBe(created[5]?.id);
      expect(seen.at(-1)).toBe(created[6]?.id);
    });

    it('carries each song’s project and folder chain', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'F');
      const project = await makeProject(db, workspace.id, 'Named', folder.id);
      await makeSong(db, workspace.id, project.id, 'S');

      const { items, next } = await listRecentSongsPage(db, workspace.id, 10, null);
      expect(next).toBeNull();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        projectId: project.id,
        projectName: 'Named',
        folderPath: folder.path,
      });
    });

    it('leaves out the songs of a deleted project', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const project = await makeProject(db, workspace.id, 'Gone');
      await makeSong(db, workspace.id, project.id, 'Orphan');
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));

      const { items } = await listRecentSongsPage(db, workspace.id, 10, null);
      expect(items).toEqual([]);
    });
  });

  describe('listSongsByIds', () => {
    it('returns only live songs in this workspace, whatever ids are asked for', async () => {
      const db = database.db;
      const { workspace } = await makeTenant(db);
      const foreign = await makeForeignTenant();
      const project = await makeProject(db, workspace.id, 'P');
      const song = await makeSong(db, workspace.id, project.id, 'Mine');

      const rows = await listSongsByIds(db, workspace.id, [song.id, foreign.song.id]);
      expect(rows.map((row) => row.id)).toEqual([song.id]);
      expect(await listSongsByIds(db, workspace.id, [])).toEqual([]);
    });
  });

  describe('listFavoritesOf', () => {
    it('resolves each favourite’s name and chain, drops deleted targets, and stays in its lane', async () => {
      const db = database.db;
      const { user, workspace } = await makeTenant(db);
      const foreign = await makeForeignTenant();
      const somebodyElse = await makeUser(db);
      await addMember(db, workspace.id, somebodyElse.id, 'editor');

      const folder = await makeFolder(db, workspace.id, 'Faves');
      const project = await makeProject(db, workspace.id, 'Loved', folder.id);
      const song = await makeSong(db, workspace.id, project.id, 'Hook');
      const deletedSong = await makeSong(db, workspace.id, project.id, 'Deleted');
      await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, deletedSong.id));

      await makeFavorite(db, workspace.id, user.id, 'folder', folder.id, new Date('2026-01-01'));
      await makeFavorite(db, workspace.id, user.id, 'project', project.id, new Date('2026-01-02'));
      await makeFavorite(db, workspace.id, user.id, 'song', song.id, new Date('2026-01-03'));
      await makeFavorite(db, workspace.id, user.id, 'song', deletedSong.id, new Date('2026-01-04'));
      // Someone else's favourite, and a favourite id pointing into the other tenant.
      await makeFavorite(db, workspace.id, somebodyElse.id, 'project', project.id);
      await makeFavorite(db, workspace.id, user.id, 'song', foreign.song.id);

      const rows = await listFavoritesOf(db, workspace.id, user.id, 50);

      expect(rows.map((row) => [row.targetType, row.name])).toEqual([
        ['song', 'Hook'],
        ['project', 'Loved'],
        ['folder', 'Faves'],
      ]);
      expect(rows[0]).toMatchObject({ projectId: project.id, folderPath: folder.path });
      expect(rows[1]).toMatchObject({ projectId: null, folderPath: folder.path });
      expect(rows[2]).toMatchObject({ projectId: null, folderPath: folder.path });
    });
  });

  describe('listContentActivityPage', () => {
    it('returns other members’ content activity only, with each target’s chain', async () => {
      const db = database.db;
      const { user: viewer, workspace } = await makeTenant(db);
      await makeForeignTenant();
      const colleague = await makeUser(db);
      await addMember(db, workspace.id, colleague.id, 'editor');

      const folder = await makeFolder(db, workspace.id, 'F');
      const project = await makeProject(db, workspace.id, 'P', folder.id);
      const song = await makeSong(db, workspace.id, project.id, 'S');
      const deleted = await makeSong(db, workspace.id, project.id, 'Deleted');
      await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, deleted.id));

      const at = (minute: number) => new Date(Date.UTC(2026, 5, 1, 12, minute));
      const kept = await makeAuditEvent(db, {
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'song.updated',
        targetType: 'song',
        targetId: song.id,
        occurredAt: at(5),
      });
      const keptProject = await makeAuditEvent(db, {
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'project.updated',
        targetType: 'project',
        targetId: project.id,
        occurredAt: at(4),
      });
      // Each of these is on a visible target and would appear without its filter:
      await makeAuditEvent(db, {
        // the viewer's own event,
        workspaceId: workspace.id,
        actorId: viewer.id,
        action: 'song.updated',
        targetType: 'song',
        targetId: song.id,
        occurredAt: at(6),
      });
      await makeAuditEvent(db, {
        // an owner-only action on a content target,
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'permission.granted',
        targetType: 'project',
        targetId: project.id,
        occurredAt: at(7),
      });
      await makeAuditEvent(db, {
        // a download, which is audit, not activity,
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'asset.downloaded',
        targetType: 'song',
        targetId: song.id,
        occurredAt: at(8),
      });
      const former = await makeUser(db);
      const formerMembership = await addMember(db, workspace.id, former.id, 'editor');
      await makeAuditEvent(db, {
        // a change by someone who has since left the workspace,
        workspaceId: workspace.id,
        actorId: former.id,
        action: 'song.updated',
        targetType: 'song',
        targetId: song.id,
        occurredAt: at(10),
      });
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, formerMembership.id));
      await makeAuditEvent(db, {
        // and a change to something since deleted.
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'song.updated',
        targetType: 'song',
        targetId: deleted.id,
        occurredAt: at(9),
      });

      const { items, next } = await listContentActivityPage(db, workspace.id, viewer.id, 50, null);

      expect(next).toBeNull();
      expect(items.map((item) => item.id)).toEqual([kept.id, keptProject.id]);
      expect(items[0]).toMatchObject({
        actorId: colleague.id,
        targetType: 'song',
        targetName: 'S',
        projectId: project.id,
        folderPath: folder.path,
      });
      expect(items[1]).toMatchObject({ targetType: 'project', targetName: 'P', projectId: null });
    });

    it('advances past a page whose rows were all dropped', async () => {
      const db = database.db;
      const { user: viewer, workspace } = await makeTenant(db);
      const colleague = await makeUser(db);
      await addMember(db, workspace.id, colleague.id, 'editor');
      const project = await makeProject(db, workspace.id, 'P');
      const song = await makeSong(db, workspace.id, project.id, 'Live');
      const deleted = await makeSong(db, workspace.id, project.id, 'Deleted');
      await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, deleted.id));

      await makeAuditEvent(db, {
        workspaceId: workspace.id,
        actorId: colleague.id,
        action: 'song.updated',
        targetType: 'song',
        targetId: song.id,
        occurredAt: new Date('2026-06-01T00:00:00Z'),
      });
      for (let index = 0; index < 3; index += 1) {
        await makeAuditEvent(db, {
          workspaceId: workspace.id,
          actorId: colleague.id,
          action: 'song.updated',
          targetType: 'song',
          targetId: deleted.id,
          occurredAt: new Date(Date.UTC(2026, 6, 1, index)),
        });
      }

      const first = await listContentActivityPage(db, workspace.id, viewer.id, 2, null);
      expect(first.items).toEqual([]);
      expect(first.next).not.toBeNull();
      const second = await listContentActivityPage(db, workspace.id, viewer.id, 2, first.next);
      expect(second.items.map((item) => item.targetName)).toEqual(['Live']);
    });
  });
});
