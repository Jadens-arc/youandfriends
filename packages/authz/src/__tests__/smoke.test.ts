import { AppError, type WorkspaceId } from '@youandfriends/contracts';
import { permissionGrants, songs, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  makeWorkspace,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthorizer } from '../authorizer';
import { scopedQuery } from '../scoped-query';
import { anonymous, memberSubject, shareLinkSubject, type Target } from '../subjects';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING authz smoke tests: ${reason}`);
}

/**
 * The mechanism, against a real database. Task `023` enumerates the matrix; this proves the
 * wiring — that the chain really is read from the materialized path, that a grant really is
 * found, and that a refusal really is 404-shaped.
 */
describeWithDatabase('authorizer', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  /** A workspace with a two-level folder, a project in it, and a song in that. */
  async function makeTree() {
    const { user, workspace } = await makeTenant(db);
    const parent = await makeFolder(db, workspace.id, `Parent ${testId()}`);
    const folder = await makeFolder(db, workspace.id, 'Album', parent.id);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');

    return { owner: user, workspace, parent, folder, project, song };
  }

  async function grant(values: {
    workspaceId: string;
    scopeType: 'folder' | 'project' | 'song';
    scopeId: string;
    userId: string;
    role?: 'viewer' | 'commenter' | 'editor' | 'owner' | null;
    canDownload?: boolean | null;
    isDeny?: boolean;
  }) {
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: values.workspaceId,
      scopeType: values.scopeType,
      scopeId: values.scopeId,
      subjectKind: 'member',
      subjectId: values.userId,
      role: values.role ?? null,
      canDownload: values.canDownload ?? null,
      isDeny: values.isDeny ?? false,
    });
  }

  const target = (
    workspaceId: string,
    scopeType: Target['scopeType'],
    scopeId: string,
  ): Target => ({
    workspaceId: workspaceId as WorkspaceId,
    scopeType,
    scopeId,
  });

  beforeAll(async () => {
    database = await createTestDatabase('authz');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('inherits a folder grant down to a song two levels below it', async () => {
    const { workspace, folder, song } = await makeTree();
    const collaborator = await makeUser(db);
    await grant({
      workspaceId: workspace.id,
      scopeType: 'folder',
      scopeId: folder.id,
      userId: collaborator.id,
      role: 'commenter',
    });

    const access = await createAuthorizer(db).resolveAccess(
      memberSubject(collaborator.id as never),
      target(workspace.id, 'song', song.id),
    );

    expect(access.role).toBe('commenter');
  });

  it('finds a grant on an ancestor folder, not only the immediate parent', async () => {
    const { workspace, parent, song } = await makeTree();
    const collaborator = await makeUser(db);
    await grant({
      workspaceId: workspace.id,
      scopeType: 'folder',
      scopeId: parent.id,
      userId: collaborator.id,
      role: 'viewer',
    });

    const access = await createAuthorizer(db).resolveAccess(
      memberSubject(collaborator.id as never),
      target(workspace.id, 'song', song.id),
    );

    expect(access.role).toBe('viewer');
  });

  it('lets a song-level grant beat a folder-level one', async () => {
    const { workspace, folder, song } = await makeTree();
    const collaborator = await makeUser(db);
    await grant({
      workspaceId: workspace.id,
      scopeType: 'folder',
      scopeId: folder.id,
      userId: collaborator.id,
      role: 'viewer',
    });
    await grant({
      workspaceId: workspace.id,
      scopeType: 'song',
      scopeId: song.id,
      userId: collaborator.id,
      role: 'editor',
    });

    const authorizer = createAuthorizer(db);
    await expect(
      authorizer.can(
        memberSubject(collaborator.id as never),
        'edit',
        target(workspace.id, 'song', song.id),
      ),
    ).resolves.toBe(true);
  });

  it('honours a song-level deny under a folder-level allow', async () => {
    const { workspace, folder, song } = await makeTree();
    const collaborator = await makeUser(db);
    await grant({
      workspaceId: workspace.id,
      scopeType: 'folder',
      scopeId: folder.id,
      userId: collaborator.id,
      role: 'editor',
    });
    await grant({
      workspaceId: workspace.id,
      scopeType: 'song',
      scopeId: song.id,
      userId: collaborator.id,
      role: null,
      isDeny: true,
    });

    const authorizer = createAuthorizer(db);
    const subject = memberSubject(collaborator.id as never);

    await expect(
      authorizer.can(subject, 'view', target(workspace.id, 'song', song.id)),
    ).resolves.toBe(false);
    // And the folder itself is still reachable — the deny was about the song.
    await expect(
      authorizer.can(subject, 'edit', target(workspace.id, 'folder', folder.id)),
    ).resolves.toBe(true);
  });

  it('gives a workspace owner access without any grant at all', async () => {
    const { owner, workspace, song } = await makeTree();

    const access = await createAuthorizer(db).resolveAccess(
      memberSubject(owner.id as never),
      target(workspace.id, 'song', song.id),
    );

    expect(access).toEqual({ role: 'owner', canDownload: true, canInvite: false });
  });

  it('refuses a stranger everything', async () => {
    const { workspace, song } = await makeTree();
    const stranger = await makeUser(db);

    const access = await createAuthorizer(db).resolveAccess(
      memberSubject(stranger.id as never),
      target(workspace.id, 'song', song.id),
    );

    expect(access).toEqual({ role: null, canDownload: false, canInvite: false });
  });

  it('refuses anonymous without touching the database', async () => {
    const { workspace, song } = await makeTree();

    const access = await createAuthorizer(db).resolveAccess(
      anonymous,
      target(workspace.id, 'song', song.id),
    );

    expect(access.role).toBeNull();
  });

  describe('cross-workspace access (THREAT_MODEL T1)', () => {
    it('refuses a target in another workspace, and cannot be told it exists', async () => {
      const theirs = await makeTree();
      const mine = await makeTenant(db);

      // A member of one workspace naming another workspace's song id — the IDOR. The answer
      // must be indistinguishable from "no such song".
      const access = await createAuthorizer(db).resolveAccess(
        memberSubject(mine.user.id as never),
        target(mine.workspace.id, 'song', theirs.song.id),
      );

      expect(access).toEqual({ role: null, canDownload: false, canInvite: false });
    });

    it('will not resolve a real song under the wrong workspace id', async () => {
      const theirs = await makeTree();
      const intruder = await makeUser(db);
      // Even holding a grant, written by hand, against the real song id.
      await grant({
        workspaceId: theirs.workspace.id,
        scopeType: 'song',
        scopeId: theirs.song.id,
        userId: intruder.id,
        role: 'owner',
      });
      const mine = await makeWorkspace(db, intruder.id);

      const access = await createAuthorizer(db).resolveAccess(
        memberSubject(intruder.id as never),
        target(mine.id, 'song', theirs.song.id),
      );

      expect(access.role).toBeNull();
    });

    it('throws 404-shaped, never 403', async () => {
      const theirs = await makeTree();
      const mine = await makeTenant(db);

      const error = await createAuthorizer(db)
        .assertCan(
          memberSubject(mine.user.id as never),
          'view',
          target(mine.workspace.id, 'song', theirs.song.id),
        )
        .then(
          () => null,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      // The true code survives internally for the audit log; the client is told `not_found`,
      // because a 403 confirms the resource exists.
      expect(appError.code).toBe('forbidden');
      expect(appError.publicCode).toBe('not_found');
      expect(appError.httpStatus).toBe(404);
    });
  });

  describe('per-request caching (THREAT_MODEL T2)', () => {
    it('resolves once within a request', async () => {
      const { owner, workspace, song } = await makeTree();
      const authorizer = createAuthorizer(db);
      const subject = memberSubject(owner.id as never);
      const where = target(workspace.id, 'song', song.id);

      const [first, second] = await Promise.all([
        authorizer.resolveAccess(subject, where),
        authorizer.resolveAccess(subject, where),
      ]);

      // The promise is cached, not the result, so concurrent checks during one render share
      // a single resolution rather than racing three of them.
      expect(first).toBe(second);
    });

    it('does not carry a decision into the next request', async () => {
      const { workspace, folder, song } = await makeTree();
      const collaborator = await makeUser(db);
      await grant({
        workspaceId: workspace.id,
        scopeType: 'folder',
        scopeId: folder.id,
        userId: collaborator.id,
        role: 'editor',
      });

      const subject = memberSubject(collaborator.id as never);
      const where = target(workspace.id, 'song', song.id);

      const firstRequest = createAuthorizer(db);
      expect((await firstRequest.resolveAccess(subject, where)).role).toBe('editor');

      await db.delete(permissionGrants).where(eq(permissionGrants.subjectId, collaborator.id));

      // The revocation takes effect on the next request, not whenever a process restarts.
      const secondRequest = createAuthorizer(db);
      expect((await secondRequest.resolveAccess(subject, where)).role).toBeNull();

      // And the first authorizer is still holding its own answer, which is why it must not
      // outlive the request it was made for.
      expect((await firstRequest.resolveAccess(subject, where)).role).toBe('editor');
    });
  });

  describe('capabilities', () => {
    it('permits a viewer to download when granted it', async () => {
      const { workspace, song } = await makeTree();
      const collaborator = await makeUser(db);
      await grant({
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        userId: collaborator.id,
        role: 'viewer',
        canDownload: true,
      });

      const authorizer = createAuthorizer(db);
      const subject = memberSubject(collaborator.id as never);
      const where = target(workspace.id, 'song', song.id);

      await expect(authorizer.can(subject, 'download', where)).resolves.toBe(true);
      await expect(authorizer.can(subject, 'edit', where)).resolves.toBe(false);
    });

    it('refuses an editor who may not download', async () => {
      const { workspace, song } = await makeTree();
      const collaborator = await makeUser(db);
      await grant({
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        userId: collaborator.id,
        role: 'editor',
        canDownload: false,
      });

      const authorizer = createAuthorizer(db);
      const subject = memberSubject(collaborator.id as never);
      const where = target(workspace.id, 'song', song.id);

      await expect(authorizer.can(subject, 'edit', where)).resolves.toBe(true);
      await expect(authorizer.can(subject, 'download', where)).resolves.toBe(false);
    });
  });

  describe('decision sink', () => {
    it('reports every decision, for task 024 to audit', async () => {
      const { owner, workspace, song } = await makeTree();
      const decisions: { allowed: boolean }[] = [];
      const authorizer = createAuthorizer(db, { onDecision: (d) => void decisions.push(d) });

      await authorizer.can(
        memberSubject(owner.id as never),
        'view',
        target(workspace.id, 'song', song.id),
      );

      expect(decisions).toEqual([expect.objectContaining({ allowed: true, action: 'view' })]);
    });
  });
});

describeWithDatabase('scopedQuery', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('authz_scoped');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('reads only its own workspace’s rows', async () => {
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);
    const myProject = await makeProject(db, mine.workspace.id, `Mine ${testId()}`);
    const theirProject = await makeProject(db, theirs.workspace.id, `Theirs ${testId()}`);
    await makeSong(db, mine.workspace.id, myProject.id, 'Mine');
    await makeSong(db, theirs.workspace.id, theirProject.id, 'Theirs');

    const scoped = await scopedQuery(
      db,
      memberSubject(mine.user.id as never),
      mine.workspace.id as WorkspaceId,
    );
    const rows = await scoped.many(songs);

    expect(rows.map((row) => row.title)).toEqual(['Mine']);
  });

  it('narrows with a caller’s condition without widening past the tenant filter', async () => {
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);
    const theirProject = await makeProject(db, theirs.workspace.id, `Theirs ${testId()}`);
    const theirSong = await makeSong(db, theirs.workspace.id, theirProject.id, 'Theirs');

    const scoped = await scopedQuery(
      db,
      memberSubject(mine.user.id as never),
      mine.workspace.id as WorkspaceId,
    );

    // Asking for a specific row in another workspace by id. The condition narrows; it cannot
    // reach past the tenant filter it is `and`ed with.
    expect(await scoped.one(songs, eq(songs.id, theirSong.id))).toBeNull();
    expect(await scoped.count(songs, eq(songs.id, theirSong.id))).toBe(0);
  });

  it('refuses a workspace the subject is not a member of', async () => {
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);

    const error = await scopedQuery(
      db,
      memberSubject(mine.user.id as never),
      theirs.workspace.id as WorkspaceId,
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    // Without this check a handle could be opened on any workspace id a caller supplied, and
    // the filter would faithfully scope the query to someone else's data.
    expect((error as AppError).publicCode).toBe('not_found');
  });

  it('refuses a share-link bearer a workspace-wide handle', async () => {
    const mine = await makeTenant(db);

    const error = await scopedQuery(
      db,
      shareLinkSubject(testId()),
      mine.workspace.id as WorkspaceId,
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    // A link to one song must not become a key to everything (THREAT_MODEL T5).
    expect((error as AppError).publicCode).toBe('not_found');
  });
});
