import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { newUlid } from '@youandfriends/contracts';
import {
  assetVersions,
  derivatives,
  mediaJobs,
  songs,
  storageObjects,
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
  unavailableReason as databaseUnavailable,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { decodeWaveform } from '@youandfriends/contracts';
import {
  assertCapabilities,
  MissingCapabilityError,
  type Capabilities,
} from '@youandfriends/media';
import {
  announceSkip,
  generateWav,
  unavailableReason as mediaUnavailable,
} from '@youandfriends/media/testing';
import { derivativeObjectKey, newObjectKey } from '@youandfriends/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  JobTimeoutError,
  NonRetryableJobError,
  processAudioVersion,
  type MediaNotificationSink,
  type PipelineDeps,
  type PipelineStage,
} from '../pipeline';
import { directoryTransfer, type DirectoryTransfer } from './directory-transfer';

const reason = databaseUnavailable() ?? mediaUnavailable();
const describeWithPrerequisites = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media job pipeline', reason);

const OPERATIONS = ['probe', 'loudness', 'stream_derivative', 'waveform'] as const;
const BUCKET = 'youandfriends-derivatives';

/**
 * The media job, end to end, with real ffmpeg and a real Postgres (task `064`).
 *
 * The fixture has something on the far side of each rule (CLAUDE.md §13):
 *
 * - The song's **current version is the one processed**, so the duration write has a row to land
 *   on — and a second song whose current version is another, so a write that ignored the filter
 *   would visibly clobber it.
 * - A **populated foreign workspace** with its own job and derivative, which every run must leave
 *   exactly as it was.
 * - Every retry test **stops the first attempt partway**, at the two points that matter: after
 *   the stream was uploaded but before it was recorded, and after it was recorded.
 */
describeWithPrerequisites('the audio processing job', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let capabilities: Capabilities;
  let originals: DirectoryTransfer;
  let bucket: DirectoryTransfer;
  let workspaceId: string;
  let foreign: { workspaceId: string; assetVersionId: string };
  let otherSongId: string;
  const events: Parameters<MediaNotificationSink>[0][] = [];

  const wav = generateWav({
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    seconds: 4,
    toneHz: 440,
  });

  async function seedVersion(
    workspace: string,
    bytes: Uint8Array = wav,
    options: { current?: boolean } = {},
  ) {
    const project = await makeProject(db, workspace, `Project ${newUlid()}`);
    const song = await makeSong(db, workspace, project.id, `Song ${newUlid()}`);
    const asset = await makeAsset(db, workspace, { songId: song.id });
    const key = newObjectKey(workspace, 'original');
    const object = await makeStorageObject(db, workspace, { key, sizeBytes: bytes.byteLength });
    const version = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    const mix = await makeMixVersion(db, workspace, song.id, version.id, 1);
    if (options.current !== false) {
      await db.update(songs).set({ currentVersionId: mix.id }).where(eq(songs.id, song.id));
    }
    await originals.put(key, bytes);
    return {
      songId: song.id,
      assetVersionId: version.id,
      input: {
        workspaceId: workspace,
        assetVersionId: version.id,
        objectKey: key,
        operations: [...OPERATIONS],
        sizeBytes: bytes.byteLength,
      },
    };
  }

  function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      db,
      originals,
      derivatives: bucket,
      derivativesBucket: BUCKET,
      bitrate: '128k',
      capabilities: async () => capabilities,
      notify: async (event) => {
        events.push(event);
      },
      ...overrides,
    };
  }

  function stopAt(stage: PipelineStage) {
    return async (reached: PipelineStage) => {
      if (reached === stage) throw new Error(`worker lost at ${stage}`);
    };
  }

  async function jobOf(assetVersionId: string) {
    const [job] = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.assetVersionId, assetVersionId));
    return job;
  }

  async function versionOf(assetVersionId: string) {
    const [row] = await db.select().from(assetVersions).where(eq(assetVersions.id, assetVersionId));
    return row;
  }

  async function derivativesOf(assetVersionId: string) {
    return db
      .select()
      .from(derivatives)
      .where(eq(derivatives.assetVersionId, assetVersionId))
      .orderBy(derivatives.kind);
  }

  async function foreignSnapshot() {
    return {
      job: await jobOf(foreign.assetVersionId),
      derivatives: await derivativesOf(foreign.assetVersionId),
      version: await versionOf(foreign.assetVersionId),
    };
  }
  let foreignBefore: Awaited<ReturnType<typeof foreignSnapshot>>;

  beforeAll(async () => {
    database = await createTestDatabase('media_jobs');
    db = database.db;
    capabilities = await assertCapabilities();
    originals = await directoryTransfer();
    bucket = await directoryTransfer();

    workspaceId = (await makeTenant(db)).workspace.id;

    // Another song in the same workspace, current version not the one any test processes.
    const other = await seedVersion(workspaceId);
    otherSongId = other.songId;
    await db.update(songs).set({ durationMs: 123_456 }).where(eq(songs.id, otherSongId));

    const foreignWorkspace = (await makeTenant(db)).workspace.id;
    const seeded = await seedVersion(foreignWorkspace);
    foreign = { workspaceId: foreignWorkspace, assetVersionId: seeded.assetVersionId };
    await db.insert(mediaJobs).values({
      id: newUlid(),
      workspaceId: foreignWorkspace,
      assetVersionId: seeded.assetVersionId,
      state: 'failed',
      attempts: 2,
      lastError: 'foreign failure',
    });
    await db.insert(derivatives).values({
      id: newUlid(),
      workspaceId: foreignWorkspace,
      assetVersionId: seeded.assetVersionId,
      kind: 'streaming_audio',
      variant: 'aac-128k',
      processingState: 'failed',
    });
    foreignBefore = await foreignSnapshot();
  }, 60_000);

  afterEach(async () => {
    expect(await foreignSnapshot()).toEqual(foreignBefore);
    const [otherSong] = await db.select().from(songs).where(eq(songs.id, otherSongId));
    expect(otherSong?.durationMs).toBe(123_456);
    events.length = 0;
  });

  afterAll(async () => {
    await originals?.cleanup();
    await bucket?.cleanup();
    await database?.teardown();
  });

  it('processes a version: analysis, a playable stream, peaks, and one transaction marking it complete', async () => {
    const { input, songId, assetVersionId } = await seedVersion(workspaceId);

    const outcome = await processAudioVersion(deps(), input, { number: 1, maxAttempts: 3 });
    expect(outcome).toEqual({ status: 'complete' });

    const version = await versionOf(assetVersionId);
    expect(version).toMatchObject({
      processingState: 'complete',
      processingError: null,
      codec: 'pcm_s16le',
      channels: 2,
      sampleRateHz: 44_100,
      bitDepth: 16,
      loudnessUnavailable: null,
    });
    expect(version?.durationMs).toBeGreaterThanOrEqual(3_990);
    expect(version?.integratedLufs).toBeLessThan(0);

    const [song] = await db.select().from(songs).where(eq(songs.id, songId));
    expect(song?.durationMs).toBe(version?.durationMs);

    const made = await derivativesOf(assetVersionId);
    expect(made.map((row) => [row.kind, row.variant, row.processingState])).toEqual([
      ['streaming_audio', 'aac-128k', 'complete'],
      ['waveform_peaks', 'yfwp-v1', 'complete'],
    ]);
    for (const row of made) {
      const key = derivativeObjectKey(workspaceId, row.id);
      expect(await bucket.has(key)).toBe(true);
      const [object] = await db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, row.storageObjectId as string));
      expect(object).toMatchObject({ bucket: BUCKET, key, workspaceId });
    }
    const peaksRow = made.find((row) => row.kind === 'waveform_peaks');
    const { readFile } = await import('node:fs/promises');
    const peaks = decodeWaveform(
      await readFile(`${bucket.root}/${derivativeObjectKey(workspaceId, peaksRow?.id as string)}`),
    );
    expect(peaks.sampleRateHz).toBe(44_100);

    expect(await jobOf(assetVersionId)).toMatchObject({
      state: 'complete',
      attempts: 1,
      lastError: null,
    });
    expect(events).toEqual([{ event: 'version.processed', workspaceId, assetVersionId }]);
  });

  it('retries a job that died after recording its stream: the stream is not made again and no row is duplicated', async () => {
    const { input, assetVersionId } = await seedVersion(workspaceId);
    const uploadsBefore = bucket.uploads.length;

    await expect(
      processAudioVersion(deps({ afterStage: stopAt('stream_recorded') }), input, {
        number: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/worker lost at stream_recorded/);

    // Between attempts: queued again, honestly — not complete, not yet failed.
    expect(await jobOf(assetVersionId)).toMatchObject({
      state: 'queued',
      attempts: 1,
      lastError: 'Error: worker lost at stream_recorded',
    });
    expect((await versionOf(assetVersionId))?.processingState).toBe('queued');
    const partial = await derivativesOf(assetVersionId);
    expect(partial.map((row) => [row.kind, row.processingState])).toEqual([
      ['streaming_audio', 'complete'],
    ]);
    const streamKey = derivativeObjectKey(workspaceId, partial[0]?.id as string);

    await processAudioVersion(deps(), input, { number: 2, maxAttempts: 3 });

    const rows = await derivativesOf(assetVersionId);
    expect(rows.map((row) => row.kind)).toEqual(['streaming_audio', 'waveform_peaks']);
    expect(rows[0]?.id).toBe(partial[0]?.id);
    expect(rows[0]?.storageObjectId).toBe(partial[0]?.storageObjectId);
    // The stream was uploaded once, by the first attempt; the second made only the peaks.
    const written = bucket.uploads.slice(uploadsBefore);
    expect(written.filter((key) => key === streamKey)).toHaveLength(1);
    expect(written).toHaveLength(2);

    const objects = await db
      .select({ id: storageObjects.id })
      .from(storageObjects)
      .where(and(eq(storageObjects.workspaceId, workspaceId), eq(storageObjects.bucket, BUCKET)));
    expect(new Set(objects.map((row) => row.id)).size).toBe(objects.length);
    expect(await jobOf(assetVersionId)).toMatchObject({ state: 'complete', attempts: 2 });
  });

  it('retries a job that died between uploading and recording: the same key is overwritten, never a second object', async () => {
    const { input, assetVersionId } = await seedVersion(workspaceId);
    const uploadsBefore = bucket.uploads.length;

    await expect(
      processAudioVersion(deps({ afterStage: stopAt('stream_uploaded') }), input, {
        number: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/stream_uploaded/);
    const [pending] = await derivativesOf(assetVersionId);
    expect(pending).toMatchObject({ kind: 'streaming_audio', storageObjectId: null });

    await processAudioVersion(deps(), input, { number: 2, maxAttempts: 3 });

    const rows = await derivativesOf(assetVersionId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(pending?.id);
    const streamKey = derivativeObjectKey(workspaceId, pending?.id as string);
    expect(bucket.uploads.slice(uploadsBefore).filter((key) => key === streamKey)).toHaveLength(2);
    const recorded = await db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.key, streamKey));
    expect(recorded).toHaveLength(1);
  });

  it('does nothing for a version that is already complete', async () => {
    const { input } = await seedVersion(workspaceId);
    await processAudioVersion(deps(), input, { number: 1, maxAttempts: 3 });
    const uploadsBefore = bucket.uploads.length;
    const downloadsBefore = originals.downloads.length;

    expect(await processAudioVersion(deps(), input, { number: 1, maxAttempts: 3 })).toEqual({
      status: 'skipped',
      reason: 'already complete',
    });
    expect(bucket.uploads.length).toBe(uploadsBefore);
    expect(originals.downloads.length).toBe(downloadsBefore);
  });

  it('removes its scratch space on every exit path: success, rejection, and failure', async () => {
    const prefix = `jobs-scratch-${process.pid}-`;
    const leftovers = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));

    const ok = await seedVersion(workspaceId);
    await processAudioVersion(deps({ tempPrefix: prefix }), ok.input, {
      number: 1,
      maxAttempts: 3,
    });
    expect(await leftovers()).toEqual([]);

    const bad = await seedVersion(workspaceId, new TextEncoder().encode('not audio at all'));
    await processAudioVersion(deps({ tempPrefix: prefix }), bad.input, {
      number: 1,
      maxAttempts: 3,
    });
    expect(await leftovers()).toEqual([]);

    const dying = await seedVersion(workspaceId);
    await expect(
      processAudioVersion(
        deps({ tempPrefix: prefix, afterStage: stopAt('loudness') }),
        dying.input,
        { number: 1, maxAttempts: 3 },
      ),
    ).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });

  it('records a file that is not audio as rejected, with no derivative and no retry', async () => {
    const { input, assetVersionId } = await seedVersion(
      workspaceId,
      new TextEncoder().encode('a text file with an audio extension'),
    );

    const outcome = await processAudioVersion(deps(), input, { number: 1, maxAttempts: 3 });
    expect(outcome.status).toBe('rejected');
    expect(await versionOf(assetVersionId)).toMatchObject({ processingState: 'failed' });
    expect((await versionOf(assetVersionId))?.processingError).toMatch(/audio|media/i);
    expect(await jobOf(assetVersionId)).toMatchObject({ state: 'failed' });
    expect(await derivativesOf(assetVersionId)).toEqual([]);
  });

  it('runs the capability probe first and fails loudly before touching anything', async () => {
    const { input, assetVersionId } = await seedVersion(workspaceId);
    const downloadsBefore = originals.downloads.length;
    const broken = { ...capabilities, missingFilters: ['ebur128'], ok: false };

    await expect(
      processAudioVersion(
        deps({
          capabilities: async () => {
            throw new MissingCapabilityError(broken);
          },
        }),
        input,
        { number: 1, maxAttempts: 3 },
      ),
    ).rejects.toBeInstanceOf(MissingCapabilityError);
    expect(originals.downloads.length).toBe(downloadsBefore);
    expect(await jobOf(assetVersionId)).toBeUndefined();
    expect((await versionOf(assetVersionId))?.processingState).toBe('queued');
  });

  it('enforces the job timeout, and a final attempt that times out is recorded as failed', async () => {
    const { input, assetVersionId } = await seedVersion(workspaceId);

    await expect(
      processAudioVersion(deps({ timeoutMs: 1 }), input, { number: 3, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(JobTimeoutError);

    expect(await jobOf(assetVersionId)).toMatchObject({ state: 'failed', attempts: 1 });
    expect((await jobOf(assetVersionId))?.lastError).toMatch(/JobTimeoutError/);
    expect(await versionOf(assetVersionId)).toMatchObject({ processingState: 'failed' });
    expect(events).toEqual([{ event: 'version.processing_failed', workspaceId, assetVersionId }]);
  });

  it('refuses a payload naming an object the version does not own, without reading it', async () => {
    const { input, assetVersionId } = await seedVersion(workspaceId);
    const downloadsBefore = originals.downloads.length;
    const elsewhere = { ...input, objectKey: newObjectKey(foreign.workspaceId, 'original') };

    await expect(
      processAudioVersion(deps(), elsewhere, { number: 1, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(originals.downloads.length).toBe(downloadsBefore);
    expect(await jobOf(assetVersionId)).toBeUndefined();
  });

  it("cannot process another workspace's version by naming it under this workspace", async () => {
    const [foreignVersion] = await db
      .select({ key: storageObjects.key })
      .from(assetVersions)
      .innerJoin(storageObjects, eq(storageObjects.id, assetVersions.storageObjectId))
      .where(eq(assetVersions.id, foreign.assetVersionId));

    const outcome = await processAudioVersion(
      deps(),
      {
        workspaceId,
        assetVersionId: foreign.assetVersionId,
        objectKey: foreignVersion?.key as string,
        operations: [...OPERATIONS],
        sizeBytes: wav.byteLength,
      },
      { number: 1, maxAttempts: 3 },
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'the version no longer exists' });
  });

  it('rejects a malformed payload without retrying', async () => {
    await expect(
      processAudioVersion(deps(), { workspaceId }, { number: 1, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
  });
});
