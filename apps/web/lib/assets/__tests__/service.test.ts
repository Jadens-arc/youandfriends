import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  assets,
  ensureScopeLimitedMembership,
  permissionGrants,
  upsertGrant,
  withTransaction,
  workspaces,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stubDriver } from '@/lib/uploads/__tests__/stub-driver';
import { completeUploadSession, createUploadSession, UploadError } from '@/lib/uploads/service';
import type { VersionContext } from '@/lib/versions/service';

import { createAsset, listUploadDestinations, readQuota, recordAssetVersion } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING upload interface service tests: ${reason}`);

const FIVE_MIB = 5 * 1024 * 1024;

/**
 * The server side of the upload interface (task `055`): creating the asset a file uploads into,
 * recording it, the writable-destination list, and the quota — against a real database.
 *
 * The fixture has a song-level deny under an editable project and a song shared alone with a
 * scope-limited collaborator, so "writable" means something different for each person, plus a
 * populated foreign tenant.
 */
describeWithDatabase('upload interface services', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const driver = stubDriver();
  const people = {} as Record<'owner' | 'editor' | 'viewer' | 'collab' | 'foreigner', string>;
  const ids = {} as Record<
    'workspace' | 'foreignWorkspace' | 'project' | 'open' | 'denied' | 'shared' | 'foreignSong',
    string
  >;

  function contextFor(userId: string, workspaceId = ids.workspace): VersionContext {
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
    database = await createTestDatabase('upload_interface');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    for (const key of ['editor', 'viewer', 'collab'] as const)
      people[key] = (await makeUser(db)).id;
    await addMember(db, ids.workspace, people.editor, 'editor');
    await addMember(db, ids.workspace, people.viewer, 'viewer');

    ids.project = (await makeProject(db, ids.workspace, 'Night Drive')).id;
    ids.open = (await makeSong(db, ids.workspace, ids.project, 'Headlights')).id;
    ids.denied = (await makeSong(db, ids.workspace, ids.project, 'Tail Lights')).id;
    ids.shared = (await makeSong(db, ids.workspace, ids.project, 'Shared One')).id;
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: ids.workspace,
      scopeType: 'song',
      scopeId: ids.denied,
      subjectKind: 'member',
      subjectId: people.editor,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, ids.workspace, people.collab, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: ids.workspace,
        scopeType: 'song',
        scopeId: ids.shared,
        subjectKind: 'member',
        subjectId: people.collab,
        role: 'editor',
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });

    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreignSong = (
      await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')
    ).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('creates an asset of an allowed kind on the right owner, filed in Project Files', async () => {
    const stem = await createAsset(contextFor(people.editor), {
      songId: ids.open as never,
      kind: 'stem',
      name: 'Drums.wav',
    });
    const file = await createAsset(contextFor(people.editor), {
      projectId: ids.project as never,
      kind: 'project_file',
      name: 'Session.logicx.zip',
      folder: 'Sessions/2026',
      tags: ['logic'],
    });
    const rows = await db.select().from(assets).where(eq(assets.workspaceId, ids.workspace));
    expect(rows.find((row) => row.id === stem.assetId)).toMatchObject({
      songId: ids.open,
      projectId: null,
      kind: 'stem',
      folderPath: '',
    });
    expect(rows.find((row) => row.id === file.assetId)).toMatchObject({
      projectId: ids.project,
      folderPath: '/Sessions/2026/',
      tags: ['logic'],
    });
  });

  it('refuses a kind that does not belong, and an unsafe folder', async () => {
    for (const input of [
      { songId: ids.open, kind: 'artwork', name: 'x.png' },
      { projectId: ids.project, kind: 'stem', name: 'x.wav' },
      { songId: ids.open, projectId: ids.project, kind: 'stem', name: 'x.wav' },
      { projectId: ids.project, kind: 'project_file', name: 'x', folder: '../escape' },
    ]) {
      const error = await refusal(createAsset(contextFor(people.owner), input as never));
      expect(error.code).toBe('validation_failed');
    }
  });

  it('refuses a viewer, a denied song, and another workspace 404-shaped', async () => {
    for (const [userId, workspaceId, songId] of [
      [people.viewer, ids.workspace, ids.open],
      [people.editor, ids.workspace, ids.denied],
      [people.owner, ids.workspace, ids.foreignSong],
      [people.foreigner, ids.foreignWorkspace, ids.open],
    ] as const) {
      const error = await refusal(
        createAsset(contextFor(userId, workspaceId), {
          songId: songId as never,
          kind: 'stem',
          name: 'x.wav',
        }),
      );
      expect(error.publicCode).toBe('not_found');
    }
  });

  it('records an upload only against the asset it was made for', async () => {
    const { assetId } = await createAsset(contextFor(people.owner), {
      songId: ids.open as never,
      kind: 'master',
      name: 'Master.wav',
    });
    const other = await createAsset(contextFor(people.owner), {
      songId: ids.open as never,
      kind: 'stem',
      name: 'Other.wav',
    });
    const context = { ...contextFor(people.owner), driver };
    const session = await createUploadSession(context, {
      assetId: assetId as never,
      sizeBytes: FIVE_MIB,
      contentTypeHint: 'audio/wav',
      filename: 'Master.wav',
    });
    await completeUploadSession({ ...context, authz: createAuthorizer(db) }, session.id, {
      parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: FIVE_MIB }],
    });

    const wrong = await refusal(
      recordAssetVersion(contextFor(people.owner), other.assetId, session.id),
    );
    expect(wrong.publicCode).toBe('not_found');
    const version = await recordAssetVersion(contextFor(people.owner), assetId, session.id);
    expect(version).toMatchObject({ assetId, versionNumber: 1, created: true });
  });

  it('offers only destinations the person may write to', async () => {
    const names = async (userId: string) =>
      (await listUploadDestinations(contextFor(userId))).map((d) => `${d.type}:${d.name}`).sort();

    expect(await names(people.owner)).toEqual([
      'project:Night Drive',
      'song:Headlights',
      'song:Shared One',
      'song:Tail Lights',
    ]);
    // The deny on Tail Lights removes it; the project and its other songs remain.
    expect(await names(people.editor)).toEqual([
      'project:Night Drive',
      'song:Headlights',
      'song:Shared One',
    ]);
    expect(await names(people.viewer)).toEqual([]);
    // A song shared alone: the song, without naming the project it sits in.
    const collab = await listUploadDestinations(contextFor(people.collab));
    expect(collab).toEqual([
      expect.objectContaining({
        type: 'song',
        name: 'Shared One',
        context: null,
        takesMixes: true,
      }),
    ]);
  });

  it('reports room left to members, and enforces the quota when a session opens', async () => {
    await db
      .update(workspaces)
      .set({ storageUsedBytes: 900, storageUsageRefreshedAt: new Date() })
      .where(eq(workspaces.id, ids.workspace));
    expect(await readQuota(contextFor(people.owner), 1000)).toEqual({
      usedBytes: 900,
      quotaBytes: 1000,
    });
    expect(await readQuota(contextFor(people.collab), 1000)).toBeNull();

    const { assetId } = await createAsset(contextFor(people.owner), {
      songId: ids.open as never,
      kind: 'stem',
      name: 'Too big.wav',
    });
    const context = { ...contextFor(people.owner), driver, quotaBytes: 900 + FIVE_MIB - 1 };
    const error = await createUploadSession(context, {
      assetId: assetId as never,
      sizeBytes: FIVE_MIB,
      contentTypeHint: 'audio/wav',
      filename: 'Too big.wav',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).code).toBe('quota_exceeded');

    const perObject = await createUploadSession(
      { ...contextFor(people.owner), driver, maxObjectBytes: FIVE_MIB - 1 },
      {
        assetId: assetId as never,
        sizeBytes: FIVE_MIB,
        contentTypeHint: 'audio/wav',
        filename: 'x.wav',
      },
    ).catch((caught: unknown) => caught);
    expect((perObject as UploadError).code).toBe('size_exceeded');

    // Room for it: opens.
    const fits = await createUploadSession(
      { ...contextFor(people.owner), driver, quotaBytes: 900 + FIVE_MIB },
      {
        assetId: assetId as never,
        sizeBytes: FIVE_MIB,
        contentTypeHint: 'audio/wav',
        filename: 'x.wav',
      },
    );
    expect(fits.id).toBeTruthy();
  });
});
