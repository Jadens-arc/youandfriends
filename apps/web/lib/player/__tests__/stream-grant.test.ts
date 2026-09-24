import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import { newUlid, type AppError, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  derivatives,
  ensureScopeLimitedMembership,
  permissionGrants,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
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
import { derivativeObjectKey } from '@youandfriends/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stubDriver, type StubDriver } from '@/lib/uploads/__tests__/stub-driver';

import { streamUrlFor } from '../stream-grant';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING stream grant tests: ${reason}`);

/**
 * Stream URLs (task `070`) through the real authorizer and a real database.
 *
 * The fixture has a row on the far side of each rule (CLAUDE.md §13): a version with a finished
 * stream, one still processing, one whose stream *failed*; a listener whose access is granted
 * and then revoked between two calls; a stranger; and a populated foreign workspace whose
 * version id is asked for by name.
 */
describeWithDatabase('stream grants', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let driver: StubDriver;
  let workspaceId: string;
  let owner: string;
  let listener: string;
  let stranger: string;
  let foreigner: string;
  let foreignWorkspaceId: string;
  const versions = {} as Record<'ready' | 'processing' | 'failed' | 'foreign', string>;
  let readyStreamKey: string;
  let songId: string;

  function contextFor(userId: string, workspace = workspaceId) {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      derivativesDriver: () => driver,
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

  async function mix(
    workspace: string,
    song: string,
    number: number,
    stream: 'complete' | 'running' | 'failed' | null,
  ) {
    const asset = await makeAsset(db, workspace, { songId: song });
    const object = await makeStorageObject(db, workspace);
    const version = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    const key = derivativeObjectKey(workspace, newUlid());
    if (stream !== null) {
      const derivedObject = await makeStorageObject(db, workspace, {
        key,
        contentType: 'audio/mp4',
      });
      await db.insert(derivatives).values({
        id: testId(),
        workspaceId: workspace,
        assetVersionId: version.id,
        kind: 'streaming_audio',
        variant: 'aac-192k',
        storageObjectId: stream === 'complete' ? derivedObject.id : null,
        processingState: stream,
      });
    }
    return { id: (await makeMixVersion(db, workspace, song, version.id, number)).id, key };
  }

  beforeAll(async () => {
    database = await createTestDatabase('stream_grants');
    db = database.db;
    driver = stubDriver();
    const tenant = await makeTenant(db);
    owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    const project = await makeProject(db, workspaceId, 'Night Drive');
    songId = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    const ready = await mix(workspaceId, songId, 1, 'complete');
    versions.ready = ready.id;
    readyStreamKey = ready.key;
    versions.processing = (await mix(workspaceId, songId, 2, 'running')).id;
    versions.failed = (await mix(workspaceId, songId, 3, 'failed')).id;

    listener = (await makeUser(db)).id;
    stranger = (await makeUser(db)).id;
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspaceId, listener, testId());
      await ensureScopeLimitedMembership(tx, workspaceId, stranger, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId,
        scopeType: 'song',
        scopeId: songId,
        subjectKind: 'member',
        subjectId: listener,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner,
      });
    });

    const foreign = await makeTenant(db);
    foreigner = foreign.user.id;
    foreignWorkspaceId = foreign.workspace.id;
    const foreignProject = await makeProject(db, foreignWorkspaceId, 'Theirs');
    const foreignSong = await makeSong(db, foreignWorkspaceId, foreignProject.id, 'Unreleased');
    versions.foreign = (await mix(foreignWorkspaceId, foreignSong.id, 1, 'complete')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('streams the derivative — never the original — to someone who may view the song', async () => {
    const grant = await streamUrlFor(contextFor(listener), versions.ready);
    // A viewer without the download capability may still listen.
    expect(grant.url).toBe(`https://bucket.example/${readyStreamKey}`);
    expect(grant.songId).toBe(songId);
    expect(new Date(grant.expiresAt).toString()).not.toBe('Invalid Date');
  });

  it('says a version is not ready while it processes, or after its stream failed', async () => {
    for (const id of [versions.processing, versions.failed]) {
      const error = await refusal(streamUrlFor(contextFor(owner), id));
      expect(error.publicCode).toBe('conflict');
    }
  });

  it('refuses a stranger, another workspace, and a foreign version by id — all 404-shaped', async () => {
    for (const [userId, workspace, id] of [
      [stranger, workspaceId, versions.ready],
      [foreigner, foreignWorkspaceId, versions.ready],
      [owner, workspaceId, versions.foreign],
      [owner, workspaceId, 'not-a-ulid'],
    ] as const) {
      const error = await refusal(streamUrlFor(contextFor(userId, workspace), id));
      expect(error.publicCode).toBe('not_found');
    }
  });

  it('re-checks authorization on every call, so revoked access stops the next refresh', async () => {
    await streamUrlFor(contextFor(listener), versions.ready);
    await db
      .delete(permissionGrants)
      .where(and(eq(permissionGrants.subjectId, listener), eq(permissionGrants.scopeId, songId)));
    const error = await refusal(streamUrlFor(contextFor(listener), versions.ready));
    expect(error.publicCode).toBe('not_found');
  });
});
