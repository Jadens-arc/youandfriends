import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COVER_RENDITION_WIDTHS,
  coverVariant,
  newUlid,
  PROCESSING_FAILURE_MESSAGES,
} from '@youandfriends/contracts';
import {
  assetVersions,
  derivatives,
  mediaJobs,
  storageObjects,
  type DirectDatabase,
} from '@youandfriends/db';
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
  probeArtwork,
  type Capabilities,
} from '@youandfriends/media';
import {
  announceSkip,
  unavailableReason as mediaUnavailable,
  writeTestImage,
} from '@youandfriends/media/testing';
import { derivativeObjectKey, newObjectKey, type ObjectTransfer } from '@youandfriends/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enqueueMediaJob, operationsFor } from '../enqueue';
import { processAudioVersion, type PipelineDeps } from '../pipeline';
import { directoryTransfer, type DirectoryTransfer } from './directory-transfer';

const reason = databaseUnavailable() ?? mediaUnavailable();
const describeWithPrerequisites = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('cover art job', reason);

/**
 * Artwork through the real job (task `069`): the renditions, their rows, a retry after a partial
 * run, and a refusal — plus the fix this task made to enqueueing, which used to send every asset
 * version, project files included, down the audio pipeline.
 */
describeWithPrerequisites('the cover art job', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let capabilities: Capabilities;
  let originals: DirectoryTransfer;
  let bucket: DirectoryTransfer;
  let workspaceId: string;
  let projectId: string;
  let scratch: string;

  function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
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
      await processAudioVersion(deps(overrides), input, { number: 1, maxAttempts: 1 });
    });
  }

  async function seed(kind: 'artwork' | 'project_file', bytes: Uint8Array) {
    const asset = await makeAsset(db, workspaceId, { projectId }, { kind });
    const key = newObjectKey(workspaceId, 'original');
    const object = await makeStorageObject(db, workspaceId, { key, sizeBytes: bytes.byteLength });
    const version = await makeAssetVersion(db, workspaceId, asset.id, object.id, 1);
    await originals.put(key, bytes);
    return { workspaceId, assetVersionId: version.id };
  }

  async function renditionsOf(assetVersionId: string) {
    return db
      .select()
      .from(derivatives)
      .where(eq(derivatives.assetVersionId, assetVersionId))
      .orderBy(derivatives.variant);
  }

  beforeAll(async () => {
    database = await createTestDatabase('cover_art_job');
    db = database.db;
    capabilities = await assertCapabilities();
    originals = await directoryTransfer();
    bucket = await directoryTransfer();
    workspaceId = (await makeTenant(db)).workspace.id;
    projectId = (await makeProject(db, workspaceId, 'Night Drive')).id;
    await makeSong(db, workspaceId, projectId, 'Headlights');
    scratch = await mkdtemp(join(tmpdir(), 'jobs-artwork-'));
  }, 60_000);

  afterAll(async () => {
    await originals?.cleanup();
    await bucket?.cleanup();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    await database?.teardown();
  });

  it('routes each kind to the work it needs', () => {
    expect(operationsFor('mix')).toEqual(['probe', 'loudness', 'stream_derivative', 'waveform']);
    expect(operationsFor('stem')).toEqual(operationsFor('mix'));
    // A voice note (task `093`) is music's pipeline, not a second one: stream, waveform, loudness.
    expect(operationsFor('voice_note')).toEqual(operationsFor('mix'));
    expect(operationsFor('artwork')).toEqual(['artwork']);
    expect(operationsFor('project_file')).toBeNull();
  });

  it('renders a square JPEG at every configured width, recorded as derivatives', async () => {
    const image = await readFile(
      await writeTestImage(scratch, `cover-${newUlid()}.png`, { width: 900, height: 700 }),
    );
    const target = await seed('artwork', image);
    expect((await enqueueMediaJob(db, inline(), target)).dispatched).toBe(true);

    const rows = await renditionsOf(target.assetVersionId);
    expect(rows.map((row) => [row.kind, row.variant, row.processingState])).toEqual(
      [...COVER_RENDITION_WIDTHS]
        .map((width) => ['thumbnail', coverVariant(width), 'complete'])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    );
    for (const row of rows) {
      const width = Number(row.variant.slice('cover-'.length));
      const path = join(bucket.root, ...derivativeObjectKey(workspaceId, row.id).split('/'));
      expect(await probeArtwork(path)).toEqual({ codec: 'mjpeg', width, height: width });
      const [object] = await db
        .select()
        .from(storageObjects)
        .where(eq(storageObjects.id, row.storageObjectId as string));
      expect(object?.contentType).toBe('image/jpeg');
    }
    const [version] = await db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.id, target.assetVersionId));
    // An image has no audio analysis; it is simply ready.
    expect(version).toMatchObject({ processingState: 'complete', codec: null, durationMs: null });
  });

  it('retries after a partial run without re-rendering what was recorded', async () => {
    const image = await readFile(
      await writeTestImage(scratch, `cover-${newUlid()}.jpg`, { width: 600, height: 600 }),
    );
    const target = await seed('artwork', image);
    let failNext = true;
    const flaky: Pick<ObjectTransfer, 'uploadFile'> = {
      async uploadFile(key, path, contentType) {
        // The second rendition's upload dies the first time — a worker lost mid-job.
        if (failNext && bucket.uploads.filter((k) => k.includes(workspaceId)).length > 0) {
          const recorded = await renditionsOf(target.assetVersionId);
          if (recorded.some((row) => row.processingState === 'complete')) {
            failNext = false;
            throw new Error('connection reset');
          }
        }
        await bucket.uploadFile(key, path, contentType);
      },
    };
    const before = bucket.uploads.length;
    await expect(
      processAudioVersion(deps({ derivatives: flaky }), await payloadOf(target), {
        number: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/connection reset/);
    const partial = await renditionsOf(target.assetVersionId);
    const done = partial.filter((row) => row.processingState === 'complete');
    expect(done).toHaveLength(1);

    await processAudioVersion(deps(), await payloadOf(target), { number: 2, maxAttempts: 3 });
    const rows = await renditionsOf(target.assetVersionId);
    expect(rows).toHaveLength(COVER_RENDITION_WIDTHS.length);
    expect(rows.every((row) => row.processingState === 'complete')).toBe(true);
    const doneKey = derivativeObjectKey(workspaceId, done[0]?.id as string);
    expect(bucket.uploads.slice(before).filter((key) => key === doneKey)).toHaveLength(1);
  });

  it('rejects a file that is not an image, in words, without retrying', async () => {
    const target = await seed('artwork', new TextEncoder().encode('<svg><script>1</script></svg>'));
    await enqueueMediaJob(db, inline(), target);
    const [version] = await db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.id, target.assetVersionId));
    expect(version).toMatchObject({
      processingState: 'failed',
      processingError: PROCESSING_FAILURE_MESSAGES.not_image,
    });
    expect(await renditionsOf(target.assetVersionId)).toEqual([]);
  });

  it('marks a project file ready without sending it to the worker', async () => {
    const target = await seed('project_file', new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]));
    let ran = false;
    const result = await enqueueMediaJob(
      db,
      new InlineDispatcher(async () => {
        ran = true;
      }),
      target,
    );
    expect(result).toEqual({ dispatched: false, reason: 'nothing to process for a project_file' });
    expect(ran).toBe(false);
    const [version] = await db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.id, target.assetVersionId));
    expect(version?.processingState).toBe('complete');
    const jobs = await db
      .select()
      .from(mediaJobs)
      .where(eq(mediaJobs.assetVersionId, target.assetVersionId));
    expect(jobs).toEqual([]);
  });

  async function payloadOf(target: { workspaceId: string; assetVersionId: string }) {
    const [row] = await db
      .select({ key: storageObjects.key, size: storageObjects.sizeBytes })
      .from(assetVersions)
      .innerJoin(storageObjects, eq(storageObjects.id, assetVersions.storageObjectId))
      .where(eq(assetVersions.id, target.assetVersionId));
    return {
      ...target,
      objectKey: row?.key as string,
      sizeBytes: row?.size as number,
      operations: ['artwork'],
    };
  }
});
