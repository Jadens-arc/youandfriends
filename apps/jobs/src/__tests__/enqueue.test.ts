import { newUlid } from '@youandfriends/contracts';
import { assetVersions, mediaJobs, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  unavailableReason as databaseUnavailable,
  type TestDatabase,
} from '@youandfriends/db/testing';
import {
  assertCapabilities,
  InlineDispatcher,
  TriggerDispatcher,
  type Capabilities,
} from '@youandfriends/media';
import {
  announceSkip,
  generateWav,
  unavailableReason as mediaUnavailable,
} from '@youandfriends/media/testing';
import { newObjectKey } from '@youandfriends/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { triggerClientFrom } from '../client';
import { enqueueMediaJob } from '../enqueue';
import { executeMediaRetry, planMediaRetry } from '../ops/retry';
import { processAudioVersion, type PipelineDeps } from '../pipeline';
import { directoryTransfer, type DirectoryTransfer } from './directory-transfer';

const reason = databaseUnavailable() ?? mediaUnavailable();
const describeWithPrerequisites = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media job enqueue and retry', reason);

/**
 * Enqueueing and `ops:media:retry` (task `064`).
 *
 * The acceptance criterion these exist for: **an unreachable dispatcher leaves the job queued and
 * the interface honest.** So the unreachable case uses the real Trigger.dev SDK pointed at a port
 * nothing listens on — not a client that throws on cue — and the assertion is on the rows the
 * version page reads.
 */
describeWithPrerequisites('enqueueing media jobs', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let capabilities: Capabilities;
  let originals: DirectoryTransfer;
  let bucket: DirectoryTransfer;
  let workspaceId: string;
  let foreignWorkspaceId: string;

  const wav = generateWav({
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 1,
    seconds: 4,
    toneHz: 220,
  });

  async function seedVersion(workspace = workspaceId) {
    const project = await makeProject(db, workspace, `Project ${newUlid()}`);
    const song = await makeSong(db, workspace, project.id, `Song ${newUlid()}`);
    const asset = await makeAsset(db, workspace, { songId: song.id });
    const key = newObjectKey(workspace, 'original');
    const object = await makeStorageObject(db, workspace, { key, sizeBytes: wav.byteLength });
    const version = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    await originals.put(key, wav);
    return { workspaceId: workspace, assetVersionId: version.id };
  }

  function pipelineDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      db,
      originals,
      derivatives: bucket,
      derivativesBucket: 'youandfriends-derivatives',
      bitrate: '128k',
      capabilities: async () => capabilities,
      ...overrides,
    };
  }

  function inline(overrides: Partial<PipelineDeps> = {}) {
    return new InlineDispatcher(async (input) => {
      await processAudioVersion(pipelineDeps(overrides), input, { number: 1, maxAttempts: 1 });
    });
  }

  async function state(assetVersionId: string) {
    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.assetVersionId, assetVersionId));
    const [version] = await db
      .select({ processingState: assetVersions.processingState })
      .from(assetVersions)
      .where(eq(assetVersions.id, assetVersionId));
    return { job, version: version?.processingState };
  }

  beforeAll(async () => {
    database = await createTestDatabase('media_enqueue');
    db = database.db;
    capabilities = await assertCapabilities();
    originals = await directoryTransfer();
    bucket = await directoryTransfer();
    workspaceId = (await makeTenant(db)).workspace.id;
    foreignWorkspaceId = (await makeTenant(db)).workspace.id;
  }, 60_000);

  afterAll(async () => {
    await originals?.cleanup();
    await bucket?.cleanup();
    await database?.teardown();
  });

  it('with no queue configured, records the job queued with the reason — never complete', async () => {
    const target = await seedVersion();
    const result = await enqueueMediaJob(db, null, target);

    expect(result).toEqual({ dispatched: false, reason: expect.stringMatching(/no job queue/) });
    const { job, version } = await state(target.assetVersionId);
    expect(job).toMatchObject({ state: 'queued', attempts: 0, runId: null });
    expect(job?.lastError).toMatch(/not dispatched: no job queue/);
    expect(version).toBe('queued');
  });

  it('with the real Trigger.dev client and an unreachable API, leaves the job queued and says why', async () => {
    const target = await seedVersion();
    const client = triggerClientFrom({
      // Assembled, not written: credential-shaped literals trip the secret scanners (CLAUDE.md §8).
      TRIGGER_SECRET_KEY: ['tr', 'dev', 'EXAMPLENOTAREALKEY'].join('_'),
      TRIGGER_API_URL: 'http://127.0.0.1:9',
    });
    expect(client).not.toBeNull();

    const result = await enqueueMediaJob(
      db,
      new TriggerDispatcher(client as NonNullable<typeof client>),
      target,
    );

    expect(result.dispatched).toBe(false);
    const { job, version } = await state(target.assetVersionId);
    expect(job).toMatchObject({ state: 'queued', runId: null });
    expect(job?.lastError).toMatch(/not dispatched: could not enqueue/);
    expect(version).toBe('queued');
  }, 120_000);

  it('returns null for the client when no key is configured, rather than a client that cannot work', () => {
    expect(triggerClientFrom({})).toBeNull();
    expect(triggerClientFrom({ TRIGGER_SECRET_KEY: '' })).toBeNull();
  });

  it('runs through a dispatcher to completion and records the run, and a second enqueue does nothing', async () => {
    const target = await seedVersion();
    const result = await enqueueMediaJob(db, inline(), target);

    expect(result).toEqual({ dispatched: true, runId: expect.any(String) });
    const { job, version } = await state(target.assetVersionId);
    expect(job).toMatchObject({ state: 'complete', attempts: 1, lastError: null });
    expect(job?.runId).toBe(result.dispatched ? result.runId : null);
    expect(version).toBe('complete');

    expect(await enqueueMediaJob(db, inline(), target)).toEqual({
      dispatched: false,
      reason: 'the job is already complete',
    });
  });

  it('ops:media:retry retries one failed version under a new key, and it completes', async () => {
    const target = await seedVersion();
    let workerLost = true;
    // One dispatcher for both runs, remembering keys the way the queue does: a retry that
    // replayed the original key would get the remembered failure back, and nothing would run.
    const dispatcher = inline({
      afterStage: async (stage) => {
        if (workerLost && stage === 'loudness') throw new Error('worker lost');
      },
    });
    await enqueueMediaJob(db, dispatcher, target);
    expect(await state(target.assetVersionId)).toMatchObject({
      job: { state: 'failed', attempts: 1 },
      version: 'failed',
    });
    workerLost = false;

    const plan = await planMediaRetry(db, {
      kind: 'version',
      assetVersionId: target.assetVersionId,
    });
    expect(plan.map((job) => job.assetVersionId)).toEqual([target.assetVersionId]);

    const [report] = await executeMediaRetry(db, dispatcher, plan);
    expect(report?.result.dispatched).toBe(true);
    expect(await state(target.assetVersionId)).toMatchObject({
      job: { state: 'complete', attempts: 2, lastError: null },
      version: 'complete',
    });
  });

  it('ops:media:retry --failed finds every failed job, and not complete, running, or fresh queued ones', async () => {
    const failed = await seedVersion();
    const foreignFailed = await seedVersion(foreignWorkspaceId);
    const complete = await seedVersion();
    const running = await seedVersion();
    const freshQueued = await seedVersion();
    const rows = [
      { target: failed, state: 'failed' as const },
      { target: foreignFailed, state: 'failed' as const },
      { target: complete, state: 'complete' as const },
      { target: running, state: 'running' as const },
      { target: freshQueued, state: 'queued' as const },
    ];
    for (const { target, state: jobState } of rows) {
      await db.insert(mediaJobs).values({ id: newUlid(), ...target, state: jobState, attempts: 1 });
    }

    const all = await planMediaRetry(db, { kind: 'all', includeStranded: true });
    const planned = new Set(all.map((job) => job.assetVersionId));
    expect(planned.has(failed.assetVersionId)).toBe(true);
    expect(planned.has(foreignFailed.assetVersionId)).toBe(true);
    expect(planned.has(complete.assetVersionId)).toBe(false);
    expect(planned.has(running.assetVersionId)).toBe(false);
    expect(planned.has(freshQueued.assetVersionId)).toBe(false);

    // Stranded: queued long enough ago that nobody is going to pick it up, and running long
    // past the point any live attempt could still be at work on it.
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    const stranded = await planMediaRetry(db, { kind: 'all', includeStranded: true }, later);
    expect(stranded.map((job) => job.assetVersionId)).toEqual(
      expect.arrayContaining([freshQueued.assetVersionId, running.assetVersionId]),
    );
    expect(stranded.map((job) => job.assetVersionId)).not.toContain(complete.assetVersionId);
    const failedOnly = await planMediaRetry(db, { kind: 'all', includeStranded: false }, later);
    expect(failedOnly.map((job) => job.assetVersionId)).not.toContain(freshQueued.assetVersionId);
    expect(failedOnly.map((job) => job.assetVersionId)).not.toContain(running.assetVersionId);

    // A live running job cannot be reset out from under its worker, even if it was planned.
    const [runningJob] = await planMediaRetry(
      db,
      { kind: 'version', assetVersionId: running.assetVersionId },
      later,
    );
    expect(runningJob).toBeDefined();
    const [refused] = await executeMediaRetry(db, null, [runningJob!]);
    expect(refused?.result).toEqual({
      dispatched: false,
      reason: 'the job changed state since it was planned',
    });
    expect(await state(running.assetVersionId)).toMatchObject({ job: { state: 'running' } });

    const scoped = await planMediaRetry(db, {
      kind: 'all',
      includeStranded: false,
      workspaceId: foreignWorkspaceId,
    });
    expect(scoped.map((job) => job.assetVersionId)).toEqual([foreignFailed.assetVersionId]);

    // With no queue, a retry resets the job to an honest `queued`, not to anything better.
    const reports = await executeMediaRetry(db, null, scoped);
    expect(reports[0]?.result.dispatched).toBe(false);
    expect(await state(foreignFailed.assetVersionId)).toMatchObject({
      job: { state: 'queued' },
      version: 'queued',
    });
  });

  it('ops:media:retry will not touch a complete version named directly', async () => {
    const target = await seedVersion();
    await enqueueMediaJob(db, inline(), target);
    expect(
      await planMediaRetry(db, { kind: 'version', assetVersionId: target.assetVersionId }),
    ).toEqual([]);
  });
});
