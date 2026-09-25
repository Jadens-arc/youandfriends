import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import { newUlid, type AppError, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  derivatives,
  ensureScopeLimitedMembership,
  permissionGrants,
  songs,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '@/lib/library/context';

import { resolveQueue } from '../queue-source';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING queue resolution tests: ${reason}`);

/**
 * Building and restoring queues (task `073`) against a real database and the real authorizer.
 *
 * The fixture has a row on the far side of each rule (CLAUDE.md §13): a song with two versions
 * and a chosen current one (which must win over the newer); a song whose only version is still
 * processing (must be left out); a project the listener cannot see, one song of which is shared
 * with them alone; a grant revoked between building and restoring; and a populated foreign
 * workspace whose version ids are asked for by name.
 */
describeWithDatabase('resolving a queue', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let owner: string;
  let listener: string;
  let workspaceId: string;
  const ids = {} as Record<
    | 'folder'
    | 'project'
    | 'hiddenProject'
    | 'first'
    | 'firstCurrent'
    | 'firstNewer'
    | 'second'
    | 'secondVersion'
    | 'processingSong'
    | 'processingVersion'
    | 'sharedSong'
    | 'sharedVersion'
    | 'hiddenSong'
    | 'hiddenVersion'
    | 'foreignVersion'
    | 'vault',
    string
  >;

  function contextFor(userId: string): LibraryContext {
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

  async function version(workspace: string, songId: string, number: number, ready = true) {
    const asset = await makeAsset(db, workspace, { songId });
    const object = await makeStorageObject(db, workspace);
    const assetVersion = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    await db.insert(derivatives).values({
      id: testId(),
      workspaceId: workspace,
      assetVersionId: assetVersion.id,
      kind: 'streaming_audio',
      variant: 'aac-192k',
      storageObjectId: ready ? (await makeStorageObject(db, workspace)).id : null,
      processingState: ready ? 'complete' : 'running',
    });
    return (await makeMixVersion(db, workspace, songId, assetVersion.id, number)).id;
  }

  beforeAll(async () => {
    database = await createTestDatabase('queue_resolution');
    db = database.db;
    const tenant = await makeTenant(db);
    owner = tenant.user.id;
    workspaceId = tenant.workspace.id;

    ids.folder = (await makeFolder(db, workspaceId, 'Albums')).id;
    ids.project = (await makeProject(db, workspaceId, 'Night Drive', ids.folder)).id;
    ids.first = (await makeSong(db, workspaceId, ids.project, 'Headlights')).id;
    ids.firstCurrent = await version(workspaceId, ids.first, 1);
    ids.firstNewer = await version(workspaceId, ids.first, 2);
    await db
      .update(songs)
      .set({ currentVersionId: ids.firstCurrent })
      .where(eq(songs.id, ids.first));
    ids.second = (await makeSong(db, workspaceId, ids.project, 'Tail Lights')).id;
    ids.secondVersion = await version(workspaceId, ids.second, 1);
    ids.processingSong = (await makeSong(db, workspaceId, ids.project, 'Unfinished')).id;
    ids.processingVersion = await version(workspaceId, ids.processingSong, 1, false);

    ids.hiddenProject = (await makeProject(db, workspaceId, 'B-sides')).id;
    ids.sharedSong = (await makeSong(db, workspaceId, ids.hiddenProject, 'Shared')).id;
    ids.sharedVersion = await version(workspaceId, ids.sharedSong, 1);
    ids.hiddenSong = (await makeSong(db, workspaceId, ids.hiddenProject, 'Secret')).id;
    ids.hiddenVersion = await version(workspaceId, ids.hiddenSong, 1);

    // A project the listener can see nothing of, with a ready song in it.
    ids.vault = (await makeProject(db, workspaceId, 'Vault')).id;
    await version(workspaceId, (await makeSong(db, workspaceId, ids.vault, 'Vaulted')).id, 1);

    listener = (await makeUser(db)).id;
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspaceId, listener, testId());
      for (const [scopeType, scopeId] of [
        ['folder', ids.folder],
        ['song', ids.sharedSong],
      ] as const) {
        await upsertGrant(tx, {
          id: testId(),
          workspaceId,
          scopeType,
          scopeId,
          subjectKind: 'member',
          subjectId: listener,
          role: 'viewer',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner,
        });
      }
    });

    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    const foreignSong = await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased');
    ids.foreignVersion = await version(foreign.workspace.id, foreignSong.id, 1);
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('plays a project’s songs in order, each at its current version, skipping what is not ready', async () => {
    const tracks = await resolveQueue(contextFor(listener), {
      kind: 'project',
      projectId: ids.project,
    });
    expect(tracks.map((track) => [track.title, track.versionId])).toEqual([
      ['Headlights', ids.firstCurrent],
      ['Tail Lights', ids.secondVersion],
    ]);
    expect(tracks[0]).toMatchObject({ versionLabel: 'Version 1', songId: ids.first });
  });

  it('plays a folder’s projects, and songs by id, only as far as the viewer may see', async () => {
    const folder = await resolveQueue(contextFor(listener), {
      kind: 'folder',
      folderId: ids.folder,
    });
    expect(folder.map((track) => track.title)).toEqual(['Headlights', 'Tail Lights']);
    const bySong = await resolveQueue(contextFor(listener), {
      kind: 'songs',
      songIds: [ids.sharedSong, ids.hiddenSong, ids.second],
    });
    expect(bySong.map((track) => track.title).sort()).toEqual(['Shared', 'Tail Lights']);
    // A song shared on its own does not bring its hidden project's cover.
    expect(bySong.find((track) => track.title === 'Shared')?.cover).toBeNull();
  });

  it('refuses a folder or a project the viewer cannot see, 404-shaped', async () => {
    for (const selection of [
      { kind: 'project', projectId: ids.vault },
      { kind: 'project', projectId: newUlid() },
      { kind: 'folder', folderId: newUlid() },
    ] as const) {
      const error = await refusal(resolveQueue(contextFor(listener), selection));
      expect(error.publicCode).toBe('not_found');
    }
    // The owner sees the vault.
    expect(
      (await resolveQueue(contextFor(owner), { kind: 'project', projectId: ids.vault })).map(
        (track) => track.title,
      ),
    ).toEqual(['Vaulted']);
    // The hidden project still yields its one shared song — and nothing else from it.
    const shared = await resolveQueue(contextFor(listener), {
      kind: 'project',
      projectId: ids.hiddenProject,
    });
    expect(shared.map((track) => track.title)).toEqual(['Shared']);
  });

  it('restores a queue in its own order, dropping revoked, missing, foreign, and unready versions', async () => {
    const stored = [
      ids.secondVersion,
      ids.hiddenVersion,
      ids.foreignVersion,
      newUlid(),
      ids.processingVersion,
      ids.sharedVersion,
      ids.firstNewer,
      ids.secondVersion,
    ];
    const before = await resolveQueue(contextFor(listener), {
      kind: 'versions',
      versionIds: stored,
    });
    expect(before.map((track) => track.versionId)).toEqual([
      ids.secondVersion,
      ids.sharedVersion,
      ids.firstNewer,
    ]);

    // Access to the shared song is revoked; the next restore drops it.
    await db
      .delete(permissionGrants)
      .where(
        and(eq(permissionGrants.subjectId, listener), eq(permissionGrants.scopeId, ids.sharedSong)),
      );
    const after = await resolveQueue(contextFor(listener), {
      kind: 'versions',
      versionIds: stored,
    });
    expect(after.map((track) => track.versionId)).toEqual([ids.secondVersion, ids.firstNewer]);
  });
});
