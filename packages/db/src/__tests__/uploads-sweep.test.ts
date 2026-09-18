import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  describeSweepPlan,
  executeUploadSweep,
  planUploadSweep,
  type MultipartAborter,
} from '../ops/uploads-sweep';
import { uploadParts, uploadSessions } from '../schema/uploads';
import { makeAsset, makeProject, makeSong, makeTenant, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING upload sweep tests: ${reason}`);
}

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-03-01T12:00:00Z');

/**
 * The fixture has to contain a row for every filter the sweep applies, or a deleted filter looks
 * identical to a working one (CLAUDE.md §13).
 *
 * The plan narrows on four things: the state, the expiry, the workspace, and whether a multipart
 * upload was ever opened. So the fixture holds one session that must be swept and one that must
 * survive for each of them — plus **part rows on the swept session**, without which
 * `partRowsDeleted` is zero whether the delete runs or not.
 */
describeWithDatabase('sweeping expired upload sessions', () => {
  let database: TestDatabase;
  let db: TestDatabase['db'];

  let workspaceId: string;
  let otherWorkspaceId: string;
  let assetId: string;
  let otherAssetId: string;
  let ownerUserId: string;
  let otherOwnerUserId: string;

  /** The ids of the seeded sessions, by what makes each one interesting. */
  let expiredWithUpload: string;
  let expiredWithUploadToo: string;
  let expiredNeverOpened: string;
  let stillLive: string;
  let alreadyCompleted: string;
  let expiredElsewhere: string;

  beforeAll(async () => {
    database = await createTestDatabase('uploads-sweep');
    db = database.db;

    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    ownerUserId = tenant.user.id;
    const project = await makeProject(db, workspaceId, 'Record', null);
    const song = await makeSong(db, workspaceId, project.id, 'Blue Hour');
    assetId = (await makeAsset(db, workspaceId, { songId: song.id })).id;

    const other = await makeTenant(db);
    otherWorkspaceId = other.workspace.id;
    otherOwnerUserId = other.user.id;
    const otherProject = await makeProject(db, otherWorkspaceId, 'Theirs', null);
    const otherSong = await makeSong(db, otherWorkspaceId, otherProject.id, 'Theirs');
    otherAssetId = (await makeAsset(db, otherWorkspaceId, { songId: otherSong.id })).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function seedSession(input: {
    workspaceId: string;
    ownerUserId: string;
    assetId: string;
    expiresAt: Date;
    uploadId: string | null;
    state?: 'pending' | 'completed' | 'aborted' | 'expired';
  }): Promise<string> {
    const id = testId();
    await db.insert(uploadSessions).values({
      id,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      assetId: input.assetId,
      objectKey: `w/${input.workspaceId}/o/${id}`,
      uploadId: input.uploadId,
      maxSizeBytes: 5 * 1024 * 1024,
      contentTypeHint: 'audio/wav',
      partSizeBytes: 5 * 1024 * 1024,
      expiresAt: input.expiresAt,
      state: input.state ?? 'pending',
    });
    return id;
  }

  beforeEach(async () => {
    await db.delete(uploadSessions);

    expiredWithUpload = await seedSession({
      workspaceId,
      ownerUserId,
      assetId,
      expiresAt: new Date(NOW.getTime() - HOUR),
      uploadId: 'multipart-1',
    });

    // Two parts already in the bucket. Without these, the part delete has nothing to remove and
    // a missing `delete` reads exactly like a working one.
    await db.insert(uploadParts).values([
      {
        id: testId(),
        workspaceId,
        sessionId: expiredWithUpload,
        partNumber: 1,
        etag: 'etag-1',
        sizeBytes: 5 * 1024 * 1024,
      },
      {
        id: testId(),
        workspaceId,
        sessionId: expiredWithUpload,
        partNumber: 2,
        etag: 'etag-2',
        sizeBytes: 5 * 1024 * 1024,
      },
    ]);

    // A **second** session with an upload to abort, in the same workspace.
    //
    // Without it the scoped plan held exactly one abortable session, so nothing proved the loop
    // reaches a second `abort()` call: a mutation that `break`s out of the loop on the first
    // caught error passed all 312 tests. One abandoned upload is not a batch, and the whole
    // reason `executeUploadSweep` catches per session is that a batch is what it gets.
    expiredWithUploadToo = await seedSession({
      workspaceId,
      ownerUserId,
      assetId,
      expiresAt: new Date(NOW.getTime() - 90 * 60 * 1000),
      uploadId: 'multipart-2',
    });

    expiredNeverOpened = await seedSession({
      workspaceId,
      ownerUserId,
      assetId,
      expiresAt: new Date(NOW.getTime() - 2 * HOUR),
      uploadId: null,
    });

    // Must survive: not expired yet. Someone is uploading through it right now.
    stillLive = await seedSession({
      workspaceId,
      ownerUserId,
      assetId,
      expiresAt: new Date(NOW.getTime() + HOUR),
      uploadId: 'multipart-live',
    });

    // Must survive: expired, but it *finished*. Aborting this one would destroy a real upload.
    alreadyCompleted = await seedSession({
      workspaceId,
      ownerUserId,
      assetId,
      expiresAt: new Date(NOW.getTime() - HOUR),
      uploadId: 'multipart-done',
      state: 'completed',
    });

    // Must survive a workspace-scoped run: expired, pending, and someone else's.
    expiredElsewhere = await seedSession({
      workspaceId: otherWorkspaceId,
      ownerUserId: otherOwnerUserId,
      assetId: otherAssetId,
      expiresAt: new Date(NOW.getTime() - HOUR),
      uploadId: 'multipart-theirs',
    });
  });

  function recordingAborter() {
    const calls: { key: string; uploadId: string }[] = [];
    const abort: MultipartAborter = async (key, uploadId) => {
      calls.push({ key, uploadId });
    };
    return { abort, calls };
  }

  describe('planning', () => {
    it('names the expired pending sessions and nothing else', async () => {
      const plan = await planUploadSweep(db, { now: NOW });
      const ids = plan.sessions.map((session) => session.id).sort();

      expect(ids).toEqual(
        [expiredWithUpload, expiredWithUploadToo, expiredNeverOpened, expiredElsewhere].sort(),
      );
      expect(ids).not.toContain(stillLive);
      expect(ids).not.toContain(alreadyCompleted);
    });

    it('separates the ones with an upload to abort', async () => {
      const plan = await planUploadSweep(db, { now: NOW });
      expect(plan.abortable.map((session) => session.id).sort()).toEqual(
        [expiredWithUpload, expiredWithUploadToo, expiredElsewhere].sort(),
      );
    });

    it('scopes to one workspace when asked', async () => {
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      expect(plan.sessions.map((session) => session.id)).not.toContain(expiredElsewhere);
      expect(plan.sessions).toHaveLength(3);
    });

    it('bounds a run', async () => {
      const plan = await planUploadSweep(db, { now: NOW, limit: 1 });
      expect(plan.sessions).toHaveLength(1);
      // Oldest first, so a backlog drains in the order it accumulated.
      expect(plan.sessions[0]?.id).toBe(expiredNeverOpened);
    });

    it('reads as a plan before it acts', async () => {
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      const described = describeSweepPlan(plan);
      expect(described).toContain('3 expired upload sessions, 2 with a multipart upload');
      expect(described).toContain('(never opened)');
    });
  });

  describe('executing', () => {
    it('aborts the upload, removes the part rows, and marks the session expired', async () => {
      const { abort, calls } = recordingAborter();
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      const result = await executeUploadSweep(db, plan, abort);

      // Both abortable sessions, oldest first.
      expect(calls).toEqual([
        { key: `w/${workspaceId}/o/${expiredWithUploadToo}`, uploadId: 'multipart-2' },
        { key: `w/${workspaceId}/o/${expiredWithUpload}`, uploadId: 'multipart-1' },
      ]);
      expect(result).toMatchObject({ swept: 3, aborted: 2, partRowsDeleted: 2, failed: [] });

      const [swept] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUpload));
      expect(swept?.state).toBe('expired');

      const remainingParts = await db
        .select()
        .from(uploadParts)
        .where(eq(uploadParts.sessionId, expiredWithUpload));
      expect(remainingParts).toHaveLength(0);
    });

    it('leaves the live and completed sessions alone', async () => {
      const { abort } = recordingAborter();
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      await executeUploadSweep(db, plan, abort);

      for (const id of [stillLive, alreadyCompleted]) {
        const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, id));
        expect(row?.state).not.toBe('expired');
      }
    });

    it('refuses to run without an aborter when there is something to abort', async () => {
      // Marking the rows without aborting the uploads strands the parts permanently: nothing
      // points at them any more, so no later run can find them.
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      await expect(executeUploadSweep(db, plan, null)).rejects.toThrow(/no aborter/);

      const [untouched] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUpload));
      expect(untouched?.state).toBe('pending');
    });

    it('runs without an aborter when nothing was ever opened', async () => {
      await db.delete(uploadSessions).where(eq(uploadSessions.id, expiredWithUpload));
      await db.delete(uploadSessions).where(eq(uploadSessions.id, expiredWithUploadToo));
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });

      const result = await executeUploadSweep(db, plan, null);
      expect(result).toMatchObject({ swept: 1, aborted: 0 });
    });

    it('leaves a session pending when its abort fails, so the next run retries it', async () => {
      // The alternative — marking it expired anyway — turns one transient bucket error into
      // parts nobody will ever look for again.
      const failing: MultipartAborter = async () => {
        throw new Error('bucket unreachable');
      };
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      const result = await executeUploadSweep(db, plan, failing);

      expect(result.failed).toEqual([
        { id: expiredWithUploadToo, reason: 'bucket unreachable' },
        { id: expiredWithUpload, reason: 'bucket unreachable' },
      ]);
      expect(result.aborted).toBe(0);

      const [stuck] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUpload));
      expect(stuck?.state).toBe('pending');

      // Its parts are still recorded, because they are still in the bucket.
      const parts = await db
        .select()
        .from(uploadParts)
        .where(eq(uploadParts.sessionId, expiredWithUpload));
      expect(parts).toHaveLength(2);

      // And the session that had nothing to abort was still swept — one failure does not
      // strand the rest of the batch.
      expect(result.swept).toBe(1);
    });

    it('keeps going after a failed abort and sweeps the ones that succeed', async () => {
      // The `try/catch` is per session so one bucket error cannot strand the rest of the batch.
      // Nothing proved that: until this fixture gained a second abortable session, a mutation
      // that `break`s out of the loop on the first caught error passed every test, because the
      // loop never had a second `abort()` call to reach.
      const calls: string[] = [];
      const flaky: MultipartAborter = async (_key, uploadId) => {
        calls.push(uploadId);
        if (uploadId === 'multipart-2') throw new Error('bucket unreachable');
      };

      const plan = await planUploadSweep(db, { now: NOW, workspaceId });
      const result = await executeUploadSweep(db, plan, flaky);

      // It reached the second one, which is the whole point.
      expect(calls).toEqual(['multipart-2', 'multipart-1']);
      expect(result.aborted).toBe(1);
      expect(result.failed).toEqual([{ id: expiredWithUploadToo, reason: 'bucket unreachable' }]);

      // The one that aborted is swept; the one that failed stays pending for the next run.
      expect(result.swept).toBe(2);
      const [succeeded] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUpload));
      expect(succeeded?.state).toBe('expired');

      const [failedRow] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUploadToo));
      expect(failedRow?.state).toBe('pending');
    });

    it('does not stamp a session that finished between planning and running', async () => {
      // The plan is a proposal, not a warrant. Someone finalizing on the last possible second
      // must not have their completed upload relabelled expired.
      const { abort } = recordingAborter();
      const plan = await planUploadSweep(db, { now: NOW, workspaceId });

      await db
        .update(uploadSessions)
        .set({ state: 'completed' })
        .where(eq(uploadSessions.id, expiredWithUpload));

      const result = await executeUploadSweep(db, plan, abort);

      expect(result.swept).toBe(2); // the never-opened one and the other abortable one
      const [saved] = await db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, expiredWithUpload));
      expect(saved?.state).toBe('completed');
    });
  });
});
