import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import { newUlid, type AppError, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import { assetVersions, auditEvents, mediaJobs, type DirectDatabase } from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
  makeMixVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { readProcessingStates, retryProcessing, type ProcessingContext } from '../processing';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING processing status tests: ${reason}`);

/**
 * Processing status and retry (task `065`), through the real authorizer and a real database.
 *
 * The fixture has a row on the far side of each rule (CLAUDE.md §13): an editor, a commenter and a
 * viewer (retry is an edit, reading is a view); a failed version *and* a complete one, so "only
 * failed" has something to refuse; a second song whose version must not be reachable under the
 * first song's id; and a populated foreign workspace whose failed version must stay failed.
 */
describeWithDatabase('processing status and retry', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  const requested: { assetVersionId: string; key: string }[] = [];
  const people = {} as Record<'owner' | 'editor' | 'commenter' | 'viewer' | 'foreigner', string>;
  const ids = {} as Record<
    'workspace' | 'foreignWorkspace' | 'song' | 'otherSong' | 'foreignSong',
    string
  >;
  const versions = {} as Record<
    'failed' | 'complete' | 'otherSongFailed' | 'foreignFailed',
    { mix: string; asset: string }
  >;

  function contextFor(userId: string, workspaceId = ids.workspace): ProcessingContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      correlationId: `test-${newUlid()}`,
      requestProcessing: async (assetVersionId, key) => {
        requested.push({ assetVersionId, key });
      },
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

  async function seedVersion(
    workspace: string,
    songId: string,
    number: number,
    state: 'failed' | 'complete',
  ) {
    const asset = await makeAsset(db, workspace, { songId });
    const object = await makeStorageObject(db, workspace);
    const version = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    await db
      .update(assetVersions)
      .set({
        processingState: state,
        processingError: state === 'failed' ? 'We couldn’t finish processing this version.' : null,
      })
      .where(eq(assetVersions.id, version.id));
    await db.insert(mediaJobs).values({
      id: newUlid(),
      workspaceId: workspace,
      assetVersionId: version.id,
      state,
      attempts: 4,
      lastError: state === 'failed' ? 'JobTimeoutError: the job ran past its limit' : null,
    });
    const mix = await makeMixVersion(db, workspace, songId, version.id, number);
    return { mix: mix.id, asset: version.id };
  }

  async function stateOf(assetVersionId: string) {
    const [version] = await db
      .select({ state: assetVersions.processingState, error: assetVersions.processingError })
      .from(assetVersions)
      .where(eq(assetVersions.id, assetVersionId));
    const [job] = await db
      .select({ state: mediaJobs.state, lastError: mediaJobs.lastError })
      .from(mediaJobs)
      .where(eq(mediaJobs.assetVersionId, assetVersionId));
    return { version, job };
  }

  beforeAll(async () => {
    database = await createTestDatabase('processing_status');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    ids.workspace = tenant.workspace.id;
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      people[role] = (await makeUser(db)).id;
      await addMember(db, ids.workspace, people[role], role);
    }
    const project = await makeProject(db, ids.workspace, 'Night Drive');
    ids.song = (await makeSong(db, ids.workspace, project.id, 'Headlights')).id;
    ids.otherSong = (await makeSong(db, ids.workspace, project.id, 'Tail Lights')).id;

    const foreign = await makeTenant(db);
    people.foreigner = foreign.user.id;
    ids.foreignWorkspace = foreign.workspace.id;
    const foreignProject = await makeProject(db, ids.foreignWorkspace, 'Theirs');
    ids.foreignSong = (
      await makeSong(db, ids.foreignWorkspace, foreignProject.id, 'Unreleased')
    ).id;
    versions.foreignFailed = await seedVersion(ids.foreignWorkspace, ids.foreignSong, 1, 'failed');
    versions.otherSongFailed = await seedVersion(ids.workspace, ids.otherSong, 1, 'failed');
    versions.complete = await seedVersion(ids.workspace, ids.song, 1, 'complete');
  }, 60_000);

  beforeEach(async () => {
    requested.length = 0;
    versions.failed = await seedVersion(
      ids.workspace,
      ids.song,
      1 + Math.floor(Math.random() * 1e6),
      'failed',
    );
  });

  afterAll(async () => {
    await database?.teardown();
  });

  it('lets anyone who can view the song read its versions’ states', async () => {
    const states = await readProcessingStates(contextFor(people.viewer), ids.song);
    expect(states).toEqual(
      expect.arrayContaining([
        { id: versions.complete.mix, processingState: 'complete' },
        { id: versions.failed.mix, processingState: 'failed' },
      ]),
    );
    expect(states.map((row) => row.id)).not.toContain(versions.otherSongFailed.mix);
  });

  it('refuses the status of another workspace’s song, 404-shaped', async () => {
    const error = await refusal(readProcessingStates(contextFor(people.owner), ids.foreignSong));
    expect(error.publicCode).toBe('not_found');
    const across = await refusal(
      readProcessingStates(contextFor(people.foreigner, ids.foreignWorkspace), ids.song),
    );
    expect(across.publicCode).toBe('not_found');
  });

  it('lets an editor retry a failed version: queued again, audited, and handed to the queue', async () => {
    await retryProcessing(contextFor(people.editor), ids.song, versions.failed.mix);

    expect(await stateOf(versions.failed.asset)).toEqual({
      version: { state: 'queued', error: null },
      job: { state: 'queued', lastError: null },
    });
    expect(requested).toEqual([
      { assetVersionId: versions.failed.asset, key: expect.stringMatching(/^retry-/) },
    ]);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'version.processing_retried'),
          eq(auditEvents.targetId, ids.song),
        ),
      )
      .orderBy(auditEvents.occurredAt);
    expect(event).toMatchObject({ workspaceId: ids.workspace, actorId: people.editor });
    expect(event?.metadata).toMatchObject({ mixVersionId: versions.failed.mix });
  });

  it('refuses a retry from anyone below editor, 404-shaped, and changes nothing', async () => {
    for (const userId of [people.commenter, people.viewer]) {
      const error = await refusal(
        retryProcessing(contextFor(userId), ids.song, versions.failed.mix),
      );
      expect(error.publicCode).toBe('not_found');
    }
    expect((await stateOf(versions.failed.asset)).version?.state).toBe('failed');
    expect(requested).toEqual([]);
  });

  it('refuses a version of another song, or of another workspace, named under this song', async () => {
    for (const [userId, workspaceId, songId, versionId] of [
      [people.owner, ids.workspace, ids.song, versions.otherSongFailed.mix],
      [people.owner, ids.workspace, ids.song, versions.foreignFailed.mix],
      [people.owner, ids.workspace, ids.foreignSong, versions.foreignFailed.mix],
      [people.foreigner, ids.foreignWorkspace, ids.song, versions.failed.mix],
    ] as const) {
      const error = await refusal(
        retryProcessing(contextFor(userId, workspaceId), songId, versionId),
      );
      expect(error.publicCode).toBe('not_found');
    }
    expect((await stateOf(versions.otherSongFailed.asset)).version?.state).toBe('failed');
    expect((await stateOf(versions.foreignFailed.asset)).version?.state).toBe('failed');
    expect(requested).toEqual([]);
  });

  it('refuses to retry a version that has not failed', async () => {
    const error = await refusal(
      retryProcessing(contextFor(people.owner), ids.song, versions.complete.mix),
    );
    expect(error.publicCode).toBe('conflict');
    expect((await stateOf(versions.complete.asset)).version?.state).toBe('complete');
  });

  it('turns two retries at once into one retry and one conflict', async () => {
    const results = await Promise.allSettled([
      retryProcessing(contextFor(people.owner), ids.song, versions.failed.mix),
      retryProcessing(contextFor(people.editor), ids.song, versions.failed.mix),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason.publicCode).toBe('conflict');
    expect(requested).toHaveLength(1);
  });
});
