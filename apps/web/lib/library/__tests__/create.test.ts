import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  listContentActivityPage,
  permissionGrants,
  projects,
  songs,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeFolder,
  makeProject,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '../context';
import { createProject, createSong } from '../create';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING project and song creation: ${reason}`);

/**
 * Creating projects and songs (task `046`), against a real database and the real `authz`. The
 * fixture has a folder the editor is denied on, so "may edit the folder" differs from "is an
 * editor", and a populated foreign tenant.
 */
describeWithDatabase('creating projects and songs', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const people = {} as Record<'owner' | 'editor' | 'commenter' | 'foreigner', string>;
  const ids = {} as Record<
    'workspace' | 'foreignWorkspace' | 'open' | 'denied' | 'foreignFolder' | 'foreignProject',
    string
  >;

  function contextFor(userId: string, workspaceId = ids.workspace): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    database = await createTestDatabase('create_library');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    people.editor = (await makeUser(db)).id;
    people.commenter = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.editor, 'editor');
    await addMember(db, ids.workspace, people.commenter, 'commenter');
    ids.open = (await makeFolder(db, ids.workspace, 'Open')).id;
    ids.denied = (await makeFolder(db, ids.workspace, 'Denied')).id;
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: ids.workspace,
      scopeType: 'folder',
      scopeId: ids.denied,
      subjectKind: 'member',
      subjectId: people.editor,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });

    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    ids.foreignFolder = (await makeFolder(db, foreign.workspace.id, 'Theirs')).id;
    ids.foreignProject = (await makeProject(db, foreign.workspace.id, 'Theirs')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('creates a project at the root and in an editable folder, audited', async () => {
    const root = await createProject(contextFor(people.editor), {
      name: '  Night Drive  ',
      artist: '',
    });
    const filed = await createProject(contextFor(people.editor), {
      name: 'Filed',
      artist: 'The Hours',
      folderId: ids.open,
    });
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        artist: projects.artist,
        folderId: projects.folderId,
      })
      .from(projects)
      .where(eq(projects.workspaceId, ids.workspace));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: root.id, name: 'Night Drive', artist: null, folderId: null },
        { id: filed.id, name: 'Filed', artist: 'The Hours', folderId: ids.open },
      ]),
    );
    const events = await db
      .select({ targetId: auditEvents.targetId })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.created'));
    expect(events.map((event) => event.targetId)).toEqual(
      expect.arrayContaining([root.id, filed.id]),
    );
  });

  it('refuses a folder the editor is denied on, a commenter at the root, and foreign folders', async () => {
    for (const attempt of [
      () => createProject(contextFor(people.editor), { name: 'X', folderId: ids.denied as never }),
      () => createProject(contextFor(people.commenter), { name: 'X' }),
      () =>
        createProject(contextFor(people.owner), {
          name: 'X',
          folderId: ids.foreignFolder as never,
        }),
      () => createProject(contextFor(people.foreigner, ids.workspace), { name: 'X' }),
    ]) {
      expect((await refusal(attempt())).publicCode).toBe('not_found');
    }
  });

  it('refuses an empty name with the shared message', async () => {
    const error = await refusal(createProject(contextFor(people.owner), { name: '   ' }));
    expect(error.code).toBe('validation_failed');
    expect(error.fields?.[0]?.message).toBe('Give the project a name.');
  });

  it('creates a song in a project the viewer may edit, and shows it as activity', async () => {
    const project = await createProject(contextFor(people.owner), { name: 'Songs Here' });
    const song = await createSong(contextFor(people.editor), project.id, { title: 'Headlights' });
    const [row] = await db.select().from(songs).where(eq(songs.id, song.id));
    expect(row).toMatchObject({ title: 'Headlights', projectId: project.id, status: 'idea' });

    const page = await listContentActivityPage(db, ids.workspace, people.owner, 50, null);
    expect(page.items.map((item) => [item.action, item.targetName])).toEqual(
      expect.arrayContaining([
        ['song.created', 'Headlights'],
        ['project.created', 'Night Drive'],
      ]),
    );

    for (const attempt of [
      () => createSong(contextFor(people.commenter), project.id, { title: 'X' }),
      () => createSong(contextFor(people.owner), ids.foreignProject, { title: 'X' }),
      () => createSong(contextFor(people.owner), 'not-an-id', { title: 'X' }),
    ]) {
      expect((await refusal(attempt())).publicCode).toBe('not_found');
    }
    const denied = await db
      .select()
      .from(songs)
      .where(and(eq(songs.workspaceId, ids.workspace), eq(songs.title, 'X')));
    expect(denied).toEqual([]);
  });
});
