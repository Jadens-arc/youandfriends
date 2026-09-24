import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  ensureScopeLimitedMembership,
  permissionGrants,
  songs,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAssetVersion,
  makeFavorite,
  makeFolder,
  makeMixVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '@/lib/library/context';

import { groupOf, readProjectWorkspace, readSongWorkspace } from '../workspace';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING song workspace use cases: ${reason}`);

describe('groupOf', () => {
  it('maps every kind to one of the four fixed groups, or to none', () => {
    expect(groupOf('master')).toBe('masters');
    expect(groupOf('stem')).toBe('stems');
    expect(groupOf('sample')).toBe('stems');
    expect(groupOf('project_file')).toBe('project_files');
    expect(groupOf('artwork')).toBe('artwork');
    // The version stack and the comment that owns it, respectively.
    expect(groupOf('mix')).toBeNull();
    expect(groupOf('voice_note')).toBeNull();
  });
});

/**
 * The song workspace (task `042`) against a real database, through the real `authz`.
 *
 * The fixture has something on the far side of every rule (CLAUDE.md §13):
 *
 *   Folder "Sessions" ─ "Night Drive" ─ "Headlights" (v1, v2 current, v3 failed)
 *                                      └ "Tail Lights"    ← song-level deny for `songDenied`
 *   foreign tenant ─ "Theirs" ─ "Unreleased"             (with versions of its own)
 *
 *   owner      — sees everything
 *   viewer     — full member, viewer role: may not see processing errors, may not download
 *   songDenied — full editor, denied on "Tail Lights"
 *   songOnly   — scope-limited, viewer on "Headlights" only: its project is never named
 *   foreigner  — owner of the other tenant
 *
 * Headlights carries one asset of every kind, including a mix and a voice note that must *not*
 * appear as files, and project-level artwork and Project Files that must.
 */
describeWithDatabase('song workspace use cases', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  const people = {} as Record<'owner' | 'viewer' | 'songDenied' | 'songOnly' | 'foreigner', string>;
  const ids = {} as Record<
    | 'workspace'
    | 'foreignWorkspace'
    | 'project'
    | 'headlights'
    | 'tailLights'
    | 'v1'
    | 'v2'
    | 'v3'
    | 'foreignProject'
    | 'foreignSong'
    | 'trashedSong',
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

  async function asset(
    owner: { songId?: string; projectId?: string },
    kind: (typeof assets.$inferInsert)['kind'],
    name: string,
    extra: { folderPath?: string; tags?: string[] } = {},
  ) {
    const [row] = await db
      .insert(assets)
      .values({
        id: testId(),
        workspaceId: ids.workspace,
        songId: owner.songId ?? null,
        projectId: owner.projectId ?? null,
        kind,
        name,
        folderPath: extra.folderPath ?? '',
        tags: extra.tags ?? [],
      })
      .returning();
    if (!row) throw new Error('asset insert returned nothing');
    const object = await makeStorageObject(db, ids.workspace, { sizeBytes: 2048 });
    const version = await makeAssetVersion(db, ids.workspace, row.id, object.id, 1);
    return { asset: row, version };
  }

  beforeAll(async () => {
    database = await createTestDatabase('song_workspace');
    db = database.db;

    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    const w = ids.workspace;

    people.viewer = (await makeUser(db)).id;
    people.songDenied = (await makeUser(db)).id;
    people.songOnly = (await makeUser(db)).id;
    await addMember(db, w, people.viewer, 'viewer');
    await addMember(db, w, people.songDenied, 'editor');

    const folder = await makeFolder(db, w, 'Sessions');
    const project = await makeProject(db, w, 'Night Drive', folder.id);
    ids.project = project.id;
    const headlights = await makeSong(db, w, project.id, 'Headlights');
    const tailLights = await makeSong(db, w, project.id, 'Tail Lights');
    const trashed = await makeSong(db, w, project.id, 'Trashed');
    ids.headlights = headlights.id;
    ids.tailLights = tailLights.id;
    ids.trashedSong = trashed.id;
    await db.update(songs).set({ deletedAt: new Date() }).where(eq(songs.id, trashed.id));

    // The version stack: three mixes, the middle one current, the newest failed.
    const mix = await asset({ songId: headlights.id }, 'mix', 'Headlights mix.wav');
    const object2 = await makeStorageObject(db, w);
    const object3 = await makeStorageObject(db, w);
    const av2 = await makeAssetVersion(db, w, mix.asset.id, object2.id, 2);
    const av3 = await makeAssetVersion(db, w, mix.asset.id, object3.id, 3);
    await db
      .update(assetVersions)
      .set({ processingState: 'complete', durationMs: 187_000, sampleRateHz: 48_000 })
      .where(eq(assetVersions.id, av2.id));
    await db
      .update(assetVersions)
      .set({ processingState: 'failed', processingError: 'ffprobe: invalid data at /tmp/x' })
      .where(eq(assetVersions.id, av3.id));
    ids.v1 = (await makeMixVersion(db, w, headlights.id, mix.version.id, 1)).id;
    ids.v2 = (await makeMixVersion(db, w, headlights.id, av2.id, 2)).id;
    ids.v3 = (await makeMixVersion(db, w, headlights.id, av3.id, 3)).id;
    await db.update(songs).set({ currentVersionId: ids.v2 }).where(eq(songs.id, headlights.id));

    // One asset of every kind on the song, plus the project's own.
    await asset({ songId: headlights.id }, 'master', 'Headlights master.wav');
    await asset({ songId: headlights.id }, 'stem', 'Drums.wav', { tags: ['drums'] });
    await asset({ songId: headlights.id }, 'sample', 'Vox chop.wav');
    await asset({ songId: headlights.id }, 'voice_note', 'Idea.m4a');
    await asset({ songId: headlights.id }, 'project_file', 'Headlights.logicx.zip', {
      folderPath: '/Logic/',
    });
    await asset({ projectId: project.id }, 'project_file', 'Session notes.txt');
    await asset({ projectId: project.id }, 'artwork', 'Cover.png');
    // Another song's stem: must not appear on Headlights.
    await asset({ songId: tailLights.id }, 'stem', 'Tail bass.wav');

    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: w,
      scopeType: 'song',
      scopeId: tailLights.id,
      subjectKind: 'member',
      subjectId: people.songDenied,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, w, people.songOnly, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: w,
        scopeType: 'song',
        scopeId: headlights.id,
        subjectKind: 'member',
        subjectId: people.songOnly,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });

    await makeFavorite(db, w, people.owner, 'song', headlights.id);
    // The same song favourited by someone else: not the owner's favourite.
    await makeFavorite(db, w, people.viewer, 'song', tailLights.id);

    // A populated foreign tenant, so a missing tenant filter has something to leak.
    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased');
    ids.foreignProject = foreignProject.id;
    ids.foreignSong = foreignSong.id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('reads the header, the version stack newest first, and the current pointer', async () => {
    const workspace = await readSongWorkspace(contextFor(people.owner), ids.headlights);

    expect(workspace.song.title).toBe('Headlights');
    expect(workspace.project).toEqual({ id: ids.project, name: 'Night Drive', artist: null });
    expect(workspace.isFavorite).toBe(true);
    expect(workspace.versions.map((version) => version.number)).toEqual([3, 2, 1]);
    expect(workspace.currentVersionId).toBe(ids.v2);
    expect(workspace.versions.filter((version) => version.isCurrent).map((v) => v.id)).toEqual([
      ids.v2,
    ]);
    expect(workspace.versions.find((version) => version.id === ids.v2)).toMatchObject({
      durationMs: 187_000,
      sampleRateHz: 48_000,
      processingState: 'complete',
    });
    expect(workspace.capabilities).toEqual({ comment: true, edit: true, download: true });
  });

  it('groups files into the four fixed groups, leaving out mixes and voice notes', async () => {
    const { files } = await readSongWorkspace(contextFor(people.owner), ids.headlights);
    const names = (group: keyof typeof files) => files[group].map((file) => file.name).sort();

    expect(names('masters')).toEqual(['Headlights master.wav']);
    expect(names('stems')).toEqual(['Drums.wav', 'Vox chop.wav']);
    expect(names('project_files')).toEqual(['Headlights.logicx.zip', 'Session notes.txt']);
    expect(names('artwork')).toEqual(['Cover.png']);
    expect(files.project_files.find((file) => file.name === 'Headlights.logicx.zip')).toMatchObject(
      { folderPath: '/Logic/', sizeBytes: 2048, versionCount: 1 },
    );
    expect(files.stems.find((file) => file.name === 'Drums.wav')?.tags).toEqual(['drums']);
  });

  it('lists the siblings the viewer can open, and hides a song-level deny', async () => {
    const owner = await readSongWorkspace(contextFor(people.owner), ids.headlights);
    expect(owner.siblings.map((song) => song.title)).toEqual(['Headlights', 'Tail Lights']);
    expect(owner.siblings.find((song) => song.id === ids.headlights)?.versionCount).toBe(3);
    // Collaborators on the song: the deny on Tail Lights does not reach Headlights.
    expect(owner.collaborators.map((person) => person.userId).sort()).toEqual(
      [people.owner, people.viewer, people.songDenied, people.songOnly].sort(),
    );

    const denied = await readSongWorkspace(contextFor(people.songDenied), ids.headlights);
    expect(denied.siblings.map((song) => song.title)).toEqual(['Headlights']);
  });

  it('lists a denied member nowhere on the song they are denied', async () => {
    const workspace = await readSongWorkspace(contextFor(people.owner), ids.tailLights);
    expect(workspace.collaborators.map((person) => person.userId)).not.toContain(people.songDenied);
  });

  it('refuses a song-level deny 404-shaped', async () => {
    const error = await refusal(readSongWorkspace(contextFor(people.songDenied), ids.tailLights));
    expect(error.publicCode).toBe('not_found');
  });

  it('never names a project a song-only collaborator cannot open', async () => {
    const workspace = await readSongWorkspace(contextFor(people.songOnly), ids.headlights);
    expect(workspace.project).toBeNull();
    expect(workspace.siblings.map((song) => song.id)).toEqual([ids.headlights]);
    expect(workspace.capabilities).toEqual({ comment: false, edit: false, download: false });
    // Membership information about the song is still theirs to see; about the project, not.
    const error = await refusal(readProjectWorkspace(contextFor(people.songOnly), ids.project));
    expect(error.publicCode).toBe('not_found');
  });

  it('shows a viewer that processing failed, but not the pipeline detail', async () => {
    const viewer = await readSongWorkspace(contextFor(people.viewer), ids.headlights);
    const failed = viewer.versions.find((version) => version.id === ids.v3);
    expect(failed?.processingState).toBe('failed');
    expect(failed?.processingError).toBeNull();
    expect(viewer.isFavorite).toBe(false);

    const owner = await readSongWorkspace(contextFor(people.owner), ids.headlights);
    expect(owner.versions.find((version) => version.id === ids.v3)?.processingError).toMatch(
      /ffprobe/,
    );
  });

  describe('404-shaped refusals', () => {
    it('refuses another workspace’s song, named from this workspace', async () => {
      const error = await refusal(readSongWorkspace(contextFor(people.owner), ids.foreignSong));
      expect(error.publicCode).toBe('not_found');
    });

    it('refuses this workspace’s song to the other tenant’s owner', async () => {
      const error = await refusal(
        readSongWorkspace(contextFor(people.foreigner, ids.foreignWorkspace), ids.headlights),
      );
      expect(error.publicCode).toBe('not_found');
      const asMember = await refusal(
        readSongWorkspace(contextFor(people.foreigner, ids.workspace), ids.headlights),
      );
      expect(asMember.publicCode).toBe('not_found');
    });

    it('refuses a song in the trash, a malformed id, and an id that never existed', async () => {
      for (const id of [ids.trashedSong, 'not-a-ulid', testId()]) {
        const error = await refusal(readSongWorkspace(contextFor(people.owner), id));
        expect(error.publicCode).toBe('not_found');
      }
    });

    it('refuses another workspace’s project', async () => {
      const error = await refusal(
        readProjectWorkspace(contextFor(people.owner), ids.foreignProject),
      );
      expect(error.publicCode).toBe('not_found');
    });
  });

  it('reads a project with the songs this viewer can open', async () => {
    const owner = await readProjectWorkspace(contextFor(people.owner), ids.project);
    expect(owner.project.name).toBe('Night Drive');
    expect(owner.folder?.name).toBe('Sessions');
    expect(owner.songs.map((song) => song.title)).toEqual(['Headlights', 'Tail Lights']);

    const denied = await readProjectWorkspace(contextFor(people.songDenied), ids.project);
    expect(denied.songs.map((song) => song.title)).toEqual(['Headlights']);
  });
});
