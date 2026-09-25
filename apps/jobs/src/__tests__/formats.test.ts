import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeWaveform, newUlid } from '@youandfriends/contracts';
import { assetVersions, derivatives, mediaJobs, type DirectDatabase } from '@youandfriends/db';
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
  probeAudio,
  topLevelBoxes,
  type Capabilities,
} from '@youandfriends/media';
import {
  announceSkip,
  expectedLufs,
  MEDIA_FIXTURES,
  unavailableReason as mediaUnavailable,
  writeFixture,
  type MediaFixture,
} from '@youandfriends/media/testing';
import { derivativeObjectKey, newObjectKey } from '@youandfriends/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enqueueMediaJob } from '../enqueue';
import { processAudioVersion } from '../pipeline';
import { directoryTransfer, type DirectoryTransfer } from './directory-transfer';

const reason = databaseUnavailable() ?? mediaUnavailable();
const describeWithPrerequisites = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media pipeline fixture suite', reason);

/** ffmpeg builds differ slightly in their loudness arithmetic; a tolerance, not a magic number. */
const LOUDNESS_TOLERANCE_LU = 0.5;

/**
 * The pipeline against every fixture class (task `066`): each generated file goes through the
 * real job — enqueue, `InlineDispatcher`, `processAudioVersion`, real ffmpeg, real Postgres — and
 * the test reads back what a person would see: the version's metadata, its loudness against the
 * value arithmetic predicts, a streaming derivative that ffprobe reads as playable AAC, and peaks
 * that decode and match a second run byte for byte.
 */
describeWithPrerequisites('the media pipeline across every fixture', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let capabilities: Capabilities;
  let originals: DirectoryTransfer;
  let bucket: DirectoryTransfer;
  let workspaceId: string;
  let scratch: string;

  const dispatcher = () =>
    new InlineDispatcher(async (input) => {
      await processAudioVersion(
        {
          db,
          originals,
          derivatives: bucket,
          derivativesBucket: 'youandfriends-derivatives',
          bitrate: '128k',
          capabilities: async () => capabilities,
        },
        input,
        { number: 1, maxAttempts: 1 },
      );
    });

  async function process(fixture: MediaFixture) {
    const bytes = await readFile(await writeFixture(fixture, await mkdtemp(join(scratch, 'f-'))));
    const project = await makeProject(db, workspaceId, `Project ${newUlid()}`);
    const song = await makeSong(db, workspaceId, project.id, fixture.name);
    const asset = await makeAsset(db, workspaceId, { songId: song.id });
    const key = newObjectKey(workspaceId, 'original');
    const object = await makeStorageObject(db, workspaceId, { key, sizeBytes: bytes.byteLength });
    const version = await makeAssetVersion(db, workspaceId, asset.id, object.id, 1);
    await originals.put(key, bytes);

    const result = await enqueueMediaJob(db, dispatcher(), {
      workspaceId,
      assetVersionId: version.id,
    });
    expect(result.dispatched).toBe(true);

    const [row] = await db.select().from(assetVersions).where(eq(assetVersions.id, version.id));
    const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.assetVersionId, version.id));
    const made = await db
      .select()
      .from(derivatives)
      .where(eq(derivatives.assetVersionId, version.id));
    const pathOf = (kind: 'streaming_audio' | 'waveform_peaks') => {
      const derivative = made.find((candidate) => candidate.kind === kind);
      if (derivative === undefined) throw new Error(`no ${kind} derivative`);
      return join(bucket.root, ...derivativeObjectKey(workspaceId, derivative.id).split('/'));
    };
    return { row, job, made, pathOf };
  }

  beforeAll(async () => {
    database = await createTestDatabase('media_fixtures');
    db = database.db;
    capabilities = await assertCapabilities();
    originals = await directoryTransfer();
    bucket = await directoryTransfer();
    workspaceId = (await makeTenant(db)).workspace.id;
    scratch = await mkdtemp(join(tmpdir(), 'jobs-fixtures-'));
  }, 60_000);

  afterAll(async () => {
    await originals?.cleanup();
    await bucket?.cleanup();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    await database?.teardown();
  });

  it('covers every supported container, plus mono, silence, very short, and very long', () => {
    const containers = new Set(MEDIA_FIXTURES.map((fixture) => fixture.container));
    expect([...containers].sort()).toEqual(['aiff', 'flac', 'm4a', 'mp3', 'wav']);
    const tones = MEDIA_FIXTURES.map((fixture) => fixture.tone);
    expect(tones.some((spec) => spec.channels === 1)).toBe(true);
    expect(tones.some((spec) => spec.amplitude === 0)).toBe(true);
    expect(tones.some((spec) => spec.seconds < 3)).toBe(true);
    expect(tones.some((spec) => spec.seconds >= 180)).toBe(true);
  });

  for (const fixture of MEDIA_FIXTURES) {
    it(`processes ${fixture.name}`, async () => {
      const { row, job, made, pathOf } = await process(fixture);
      const expected = fixture.expect;

      expect(job).toMatchObject({ state: 'complete', attempts: 1, lastError: null });
      expect(row).toMatchObject({
        processingState: 'complete',
        codec: expected.codec,
        sampleRateHz: expected.sampleRateHz,
        channels: expected.channels,
        bitDepth: expected.bitDepth,
        loudnessUnavailable: expected.loudnessUnavailable,
      });
      expect(Math.abs((row?.durationMs ?? 0) - fixture.tone.seconds * 1000)).toBeLessThanOrEqual(
        expected.durationToleranceMs,
      );

      const lufs = expectedLufs(fixture.tone);
      if (expected.loudnessUnavailable === null && lufs !== null) {
        expect(row?.integratedLufs).not.toBeNull();
        expect(Math.abs((row?.integratedLufs as number) - lufs)).toBeLessThanOrEqual(
          LOUDNESS_TOLERANCE_LU,
        );
      } else {
        expect(row?.integratedLufs).toBeNull();
      }

      expect(made.map((derivative) => derivative.processingState)).toEqual([
        'complete',
        'complete',
      ]);

      // Playable: AAC-LC, 44.1 kHz stereo whatever came in, index before media, and as long as
      // its source.
      const stream = pathOf('streaming_audio');
      const probe = await probeAudio(stream);
      expect(probe).toMatchObject({ codec: 'aac', sampleRateHz: 44_100, channels: 2 });
      expect(Math.abs(probe.durationMs - fixture.tone.seconds * 1000)).toBeLessThanOrEqual(150);
      const head = new Uint8Array(await readFile(stream)).subarray(0, 4096);
      expect(topLevelBoxes(head).slice(0, 2)).toEqual(['ftyp', 'moov']);

      const peaks = decodeWaveform(await readFile(pathOf('waveform_peaks')));
      expect(peaks.sampleRateHz).toBe(expected.sampleRateHz);
      expect(peaks.tiers.length).toBeGreaterThanOrEqual(1);
      if (fixture.tone.amplitude === 0) {
        expect(peaks.tiers.every((tier) => tier.peaks.every((value) => value === 0))).toBe(true);
      }
    }, 120_000);
  }

  it('produces byte-identical peaks for identical input', async () => {
    const fixture = MEDIA_FIXTURES.find((candidate) => candidate.container === 'flac');
    if (fixture === undefined) throw new Error('no flac fixture');
    const first = await process(fixture);
    const second = await process(fixture);
    expect(await readFile(second.pathOf('waveform_peaks'))).toEqual(
      await readFile(first.pathOf('waveform_peaks')),
    );
  }, 120_000);
});
