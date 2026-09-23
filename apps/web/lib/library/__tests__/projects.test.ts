import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
  permissionGrants,
  workspaceMemberships,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAuditEvent,
  makeFavorite,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  setUpdatedAt,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '../context';
import { collectVisible, readProjectLibrary, type ProjectLibrary } from '../projects';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING project library use cases: ${reason}`);

const QUOTA = 10 * 1024 ** 3;

/**
 * The project library (task `041`) against a real database, through the real `authz`.
 *
 * One shared workspace, built so that every filter has something on the far side of it
 * (CLAUDE.md §13):
 *
 *   Folder A ─ Folder A1 ─ "Deep"      (songs: Deep One, Deep Two)
 *            └ "Denied"                (song: Denied Song)  ← project-level deny for `denied`
 *   Folder B ─ "Bravo"                 (song: Bravo Song)   ← song shared alone with `songOnly`
 *   (unfiled)  "Loose"                 (song: Loose Song)
 *
 *   owner      — sees everything
 *   editor     — full member
 *   denied     — full editor, denied on project "Denied"
 *   songDenied — full editor, denied on song "Deep Two" (the newest song in "Deep")
 *   former     — was an editor, acted on "Deep", then was removed from the workspace
 *   collab     — scope-limited, commenter on Folder A, and viewer on "Deep One" directly
 *   deepCollab — scope-limited, viewer on Folder A1 only (Folder A is an invisible ancestor)
 *   songOnly   — scope-limited, viewer on "Bravo Song" only
 *
 * plus a second tenant with its own projects, favourites, and activity. Activity is placed on
 * hidden and visible targets, by other people and by the viewer, in allowed and owner-only
 * actions; favourites point at hidden and visible targets.
 */
describeWithDatabase('project library use cases', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  const people = {} as Record<
    | 'owner'
    | 'editor'
    | 'denied'
    | 'songDenied'
    | 'former'
    | 'collab'
    | 'deepCollab'
    | 'songOnly'
    | 'stranger',
    string
  >;
  const ids = {} as Record<
    | 'workspace'
    | 'folderA'
    | 'folderA1'
    | 'folderB'
    | 'deep'
    | 'deniedProject'
    | 'bravo'
    | 'loose'
    | 'bravoSong'
    | 'deniedSong'
    | 'foreignProject'
    | 'foreignSong',
    string
  >;

  function contextFor(userId: string, database_: DirectDatabase = db): LibraryContext {
    return {
      db: database_,
      authz: createAuthorizer(database_),
      subject: memberSubject(userId as UserId),
      workspaceId: ids.workspace as WorkspaceId,
      userId,
    };
  }

  function read(userId: string, folderId: string | null = null): Promise<ProjectLibrary> {
    return readProjectLibrary(contextFor(userId), { folderId, quotaBytes: QUOTA });
  }

  const names = (items: readonly { name: string }[]) => items.map((item) => item.name).sort();

  async function grant(
    userId: string,
    scopeType: 'folder' | 'project' | 'song',
    scopeId: string,
    role: 'viewer' | 'commenter' | 'editor',
  ) {
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, ids.workspace, userId, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: ids.workspace,
        scopeType,
        scopeId,
        subjectKind: 'member',
        subjectId: userId,
        role,
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase('library_projects');
    db = database.db;

    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    const w = ids.workspace;

    for (const key of [
      'editor',
      'denied',
      'songDenied',
      'former',
      'collab',
      'deepCollab',
      'songOnly',
      'stranger',
    ] as const) {
      people[key] = (await makeUser(db)).id;
    }
    await addMember(db, w, people.editor, 'editor');
    await addMember(db, w, people.denied, 'editor');
    await addMember(db, w, people.songDenied, 'editor');
    const formerMembership = await addMember(db, w, people.former, 'editor');

    const folderA = await makeFolder(db, w, 'Folder A');
    const folderA1 = await makeFolder(db, w, 'Folder A1', folderA.id);
    const folderB = await makeFolder(db, w, 'Folder B');
    ids.folderA = folderA.id;
    ids.folderA1 = folderA1.id;
    ids.folderB = folderB.id;

    const deep = await makeProject(db, w, 'Deep', folderA1.id);
    const deniedProject = await makeProject(db, w, 'Denied', folderA.id);
    const bravo = await makeProject(db, w, 'Bravo', folderB.id);
    const loose = await makeProject(db, w, 'Loose');
    ids.deep = deep.id;
    ids.deniedProject = deniedProject.id;
    ids.bravo = bravo.id;
    ids.loose = loose.id;

    const deepOne = await makeSong(db, w, deep.id, 'Deep One');
    const deepTwo = await makeSong(db, w, deep.id, 'Deep Two');
    const deniedSong = await makeSong(db, w, deniedProject.id, 'Denied Song');
    const bravoSong = await makeSong(db, w, bravo.id, 'Bravo Song');
    const looseSong = await makeSong(db, w, loose.id, 'Loose Song');
    ids.bravoSong = bravoSong.id;
    ids.deniedSong = deniedSong.id;

    // Distinct, known recency: the hidden songs are the *newest*, so a limit applied before the
    // visibility filter would starve a collaborator's module.
    await setUpdatedAt(db, 'songs', bravoSong.id, '2026-09-01T00:00:00Z');
    await setUpdatedAt(db, 'songs', looseSong.id, '2026-08-31T00:00:00Z');
    await setUpdatedAt(db, 'songs', deniedSong.id, '2026-08-30T00:00:00Z');
    await setUpdatedAt(db, 'songs', deepTwo.id, '2026-08-02T00:00:00Z');
    await setUpdatedAt(db, 'songs', deepOne.id, '2026-08-01T00:00:00Z');
    await setUpdatedAt(
      db,
      'projects',
      [deep.id, deniedProject.id, bravo.id, loose.id],
      '2026-07-01T00:00:00Z',
    );

    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: w,
      scopeType: 'project',
      scopeId: deniedProject.id,
      subjectKind: 'member',
      subjectId: people.denied,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: w,
      scopeType: 'song',
      scopeId: deepTwo.id,
      subjectKind: 'member',
      subjectId: people.songDenied,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    await grant(people.collab, 'folder', folderA.id, 'commenter');
    // Also shared a song directly — inside a project they can already open, so it belongs to
    // that project's entry in "Shared with me", not a second, song-only one.
    await grant(people.collab, 'song', deepOne.id, 'viewer');
    await grant(people.deepCollab, 'folder', folderA1.id, 'viewer');
    await grant(people.songOnly, 'song', bravoSong.id, 'viewer');

    // Favourites: the collaborator starred one thing they can see and two they cannot.
    await makeFavorite(db, w, people.collab, 'project', deep.id, new Date('2026-09-01'));
    await makeFavorite(db, w, people.collab, 'project', bravo.id, new Date('2026-09-02'));
    await makeFavorite(db, w, people.collab, 'folder', folderB.id, new Date('2026-09-03'));

    // Activity by the editor on a hidden and a visible target, an owner-only action on a
    // visible target, and the collaborator's own change.
    const at = (day: number) => new Date(Date.UTC(2026, 8, day));
    await makeAuditEvent(db, {
      workspaceId: w,
      actorId: people.editor,
      action: 'song.updated',
      targetType: 'song',
      targetId: bravoSong.id,
      occurredAt: at(10),
    });
    await makeAuditEvent(db, {
      workspaceId: w,
      actorId: people.editor,
      action: 'project.updated',
      targetType: 'project',
      targetId: deep.id,
      occurredAt: at(9),
    });
    await makeAuditEvent(db, {
      // By someone no longer in the workspace: their name must not resurface.
      workspaceId: w,
      actorId: people.former,
      action: 'project.updated',
      targetType: 'project',
      targetId: deep.id,
      occurredAt: at(8),
    });
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, formerMembership.id));
    await makeAuditEvent(db, {
      workspaceId: w,
      actorId: people.owner,
      action: 'permission.granted',
      targetType: 'project',
      targetId: deep.id,
      occurredAt: at(11),
    });
    await makeAuditEvent(db, {
      workspaceId: w,
      actorId: people.collab,
      action: 'song.updated',
      targetType: 'song',
      targetId: deepOne.id,
      occurredAt: at(12),
    });

    // The other tenant, populated on every table the library reads.
    const foreign = await makeTenant(db);
    const foreignFolder = await makeFolder(db, foreign.workspace.id, 'Elsewhere');
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Foreign', foreignFolder.id);
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Foreign Song');
    ids.foreignProject = foreignProject.id;
    ids.foreignSong = foreignSong.id;
    await addMember(db, foreign.workspace.id, people.editor, 'editor');
    await makeFavorite(db, foreign.workspace.id, people.owner, 'project', foreignProject.id);
    await makeAuditEvent(db, {
      workspaceId: foreign.workspace.id,
      actorId: people.editor,
      action: 'song.updated',
      targetType: 'song',
      targetId: foreignSong.id,
      occurredAt: at(20),
    });
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  describe('project cards', () => {
    it('gives the owner every project, with counts and collaborators computed', async () => {
      const library = await read(people.owner);

      expect(names(library.projects)).toEqual(['Bravo', 'Deep', 'Denied', 'Loose']);
      const deep = library.projects.find((project) => project.id === ids.deep);
      expect(deep?.songCount).toBe(2);
      expect(deep?.cover).toBeNull();
      expect(deep?.lastActivityAt).toEqual(new Date('2026-08-02T00:00:00Z'));
    });

    it('lists as collaborators exactly the people each project is open to', async () => {
      const library = await read(people.owner);
      const collaboratorsOf = (id: string) =>
        library.projects
          .find((project) => project.id === id)
          ?.collaborators.map((person) => person.userId)
          .sort();

      // Deep: every full member, the Folder A collaborator, and the Folder A1 collaborator.
      expect(collaboratorsOf(ids.deep)).toEqual(
        [
          people.owner,
          people.editor,
          people.denied,
          people.songDenied,
          people.collab,
          people.deepCollab,
        ].sort(),
      );
      // Denied: the denied editor is gone; the A1-only collaborator never reached it.
      expect(collaboratorsOf(ids.deniedProject)).toEqual(
        [people.owner, people.editor, people.songDenied, people.collab].sort(),
      );
      // Bravo: the song-only collaborator reaches a song, not the project.
      expect(collaboratorsOf(ids.bravo)).toEqual(
        [people.owner, people.editor, people.denied, people.songDenied].sort(),
      );
    });

    it('drops a project denied to a full member, and nothing else', async () => {
      const library = await read(people.denied);
      expect(names(library.projects)).toEqual(['Bravo', 'Deep', 'Loose']);
    });

    it('gives a scope-limited collaborator only what their folder grant reaches', async () => {
      const library = await read(people.collab);
      expect(names(library.projects)).toEqual(['Deep', 'Denied']);
      expect(library.hasAnyProject).toBe(true);
    });

    it('never names an invisible ancestor folder anywhere in the result', async () => {
      // Deep sits at /A/A1/. This collaborator can see A1 but not A, and A's id must not reach
      // them — not as a card, not as a module entry, not buried in a field.
      const library = await read(people.deepCollab);
      expect(names(library.projects)).toEqual(['Deep']);
      const payload = JSON.stringify(library);
      expect(payload).not.toContain(ids.folderA);
      expect(payload).not.toContain(ids.folderB);
    });

    it('shows a folder’s whole subtree when a folder is open', async () => {
      const inA = await read(people.owner, ids.folderA);
      expect(names(inA.projects)).toEqual(['Deep', 'Denied']);
      const inA1 = await read(people.owner, ids.folderA1);
      expect(names(inA1.projects)).toEqual(['Deep']);
    });

    it('applies the same visibility filter inside a folder as at the root', async () => {
      // Folder A is open to this editor; the project-level deny inside it must still hold.
      const inA = await read(people.denied, ids.folderA);
      expect(names(inA.projects)).toEqual(['Deep']);
      const collabInA1 = await read(people.deepCollab, ids.folderA1);
      expect(names(collabInA1.projects)).toEqual(['Deep']);
      // A folder open to nobody here yields nothing, not the folder's real contents.
      const collabInB = await read(people.collab, ids.folderB);
      expect(collabInB.projects).toEqual([]);
    });

    it('counts and dates a card only by the songs this viewer can see', async () => {
      const owner = await read(people.owner);
      const hidden = await read(people.songDenied);
      const deepFor = (library: ProjectLibrary) =>
        library.projects.find((project) => project.id === ids.deep);
      expect(deepFor(owner)?.songCount).toBe(2);
      expect(deepFor(owner)?.lastActivityAt).toEqual(new Date('2026-08-02T00:00:00Z'));
      // "Deep Two" is denied to them: not counted, and its edit time is not the card's.
      expect(deepFor(hidden)?.songCount).toBe(1);
      expect(deepFor(hidden)?.lastActivityAt).toEqual(new Date('2026-08-01T00:00:00Z'));
      expect(hidden.modules.recentSongs.map((song) => song.title)).not.toContain('Deep Two');
    });

    it('treats a song-only collaborator as having no projects, and says so for first run', async () => {
      const library = await read(people.songOnly);
      expect(library.projects).toEqual([]);
      expect(library.hasAnyProject).toBe(false);
    });

    it('refuses someone with no membership, before reading anything', async () => {
      const error = await readProjectLibrary(contextFor(people.stranger), {
        folderId: null,
        quotaBytes: QUOTA,
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as AppError | null)?.publicCode).toBe('not_found');
    });

    it('never reaches into another workspace', async () => {
      const payload = JSON.stringify(await read(people.editor));
      expect(payload).not.toContain(ids.foreignProject);
      expect(payload).not.toContain(ids.foreignSong);
      expect(payload).not.toContain('Foreign');
    });
  });

  describe('secondary modules', () => {
    it('fills recent songs from what this viewer can open, however far down it is', async () => {
      const collab = await read(people.collab);
      // The three newest songs are hidden from them; theirs come after.
      expect(collab.modules.recentSongs.map((song) => song.title)).toEqual([
        'Denied Song',
        'Deep Two',
        'Deep One',
      ]);

      const denied = await read(people.denied);
      expect(denied.modules.recentSongs.map((song) => song.title)).not.toContain('Denied Song');
    });

    it('lists what was shared with a collaborator, including a song shared on its own', async () => {
      const collab = await read(people.collab);
      expect(names(collab.modules.sharedWithMe.projects)).toEqual(['Deep', 'Denied']);
      expect(collab.modules.sharedWithMe.songs).toEqual([]);

      const songOnly = await read(people.songOnly);
      expect(songOnly.modules.sharedWithMe.projects).toEqual([]);
      expect(songOnly.modules.sharedWithMe.songs.map((song) => song.title)).toEqual(['Bravo Song']);
      expect(songOnly.modules.recentSongs.map((song) => song.title)).toEqual(['Bravo Song']);
      // Its project is closed to them, so it is never named, and its id never reaches them.
      expect(songOnly.modules.sharedWithMe.songs[0]).toMatchObject({
        projectId: null,
        projectName: null,
      });
      expect(songOnly.modules.recentSongs[0]?.projectName).toBeNull();
      expect(JSON.stringify(songOnly)).not.toContain(ids.bravo);

      // Where the project is visible, it is named.
      expect(collab.modules.recentSongs[0]?.projectName).toBe('Denied');
    });

    it('does not count workspace membership as sharing', async () => {
      const editor = await read(people.editor);
      expect(editor.modules.sharedWithMe.projects).toEqual([]);
    });

    it('shows only the favourites this viewer can still open', async () => {
      const collab = await read(people.collab);
      expect(collab.modules.favorites.map((favorite) => favorite.name)).toEqual(['Deep']);
    });

    it('shows collaborator activity only on visible targets, only content, never your own', async () => {
      const collab = await read(people.collab);
      expect(
        collab.modules.activity.map((item) => [item.actorName.length > 0, item.targetName]),
      ).toEqual([[true, 'Deep']]);
      expect(collab.modules.activity[0]?.action).toBe('project.updated');

      // To the owner, the collaborator is somebody else — their change is activity too.
      const owner = await read(people.owner);
      expect(owner.modules.activity.map((item) => item.targetName)).toEqual([
        'Deep One',
        'Bravo Song',
        'Deep',
      ]);
    });

    it('shows storage to members who may see settings, and to no one else', async () => {
      const owner = await read(people.owner);
      expect(owner.modules.storage).toEqual({ usedBytes: 0, quotaBytes: QUOTA });
      const editor = await read(people.editor);
      expect(editor.modules.storage).not.toBeNull();
      const collab = await read(people.collab);
      expect(collab.modules.storage).toBeNull();
    });
  });

  describe('query count', () => {
    function countingDatabase(): { db: DirectDatabase; count: () => number } {
      let statements = 0;
      const proxy = new Proxy(db, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (
            (property === 'select' || property === 'execute' || property === 'transaction') &&
            typeof value === 'function'
          ) {
            return (...args: unknown[]) => {
              statements += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      });
      return { db: proxy, count: () => statements };
    }

    it('does not grow with the number of projects', async () => {
      const before = countingDatabase();
      await readProjectLibrary(contextFor(people.owner, before.db), {
        folderId: null,
        quotaBytes: QUOTA,
      });

      // A realistic library's worth more: forty projects of three songs each.
      const w = ids.workspace;
      const folder = await makeFolder(db, w, 'Catalogue');
      for (let index = 0; index < 40; index += 1) {
        const project = await makeProject(db, w, `Catalogue ${index}`, folder.id);
        for (const title of ['One', 'Two', 'Three']) await makeSong(db, w, project.id, title);
      }

      const after = countingDatabase();
      const library = await readProjectLibrary(contextFor(people.owner, after.db), {
        folderId: null,
        quotaBytes: QUOTA,
      });

      expect(library.projects.length).toBeGreaterThanOrEqual(44);
      expect(after.count()).toBe(before.count());
    });
  });
});

describe('collectVisible', () => {
  it('keeps paging past a page with nothing visible, and stops once full', async () => {
    const pages = [
      { items: [1, 3, 5], next: { at: 'a', id: '1' } },
      { items: [7, 8, 9], next: { at: 'b', id: '2' } },
      { items: [10, 12], next: null },
    ];
    let reads = 0;
    const found = await collectVisible(
      async () => pages[reads++] ?? { items: [], next: null },
      (value) => value % 2 === 0,
      2,
    );
    expect(found).toEqual([8, 10]);
    expect(reads).toBe(3);
  });

  it('stops when the listing ends, returning what it found', async () => {
    let reads = 0;
    const found = await collectVisible(
      async () => {
        reads += 1;
        return { items: [2], next: null };
      },
      () => true,
      5,
    );
    expect(found).toEqual([2]);
    expect(reads).toBe(1);
  });

  it('gives up after a bounded number of pages', async () => {
    let reads = 0;
    const found = await collectVisible(
      async () => {
        reads += 1;
        return { items: [1], next: { at: 'x', id: String(reads) } };
      },
      () => false,
      5,
    );
    expect(found).toEqual([]);
    expect(reads).toBe(6);
  });
});
