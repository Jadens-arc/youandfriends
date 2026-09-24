import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { newUlid, type NotificationEvent } from '@youandfriends/contracts';
import {
  assetVersions,
  derivatives,
  mediaJobs,
  mixVersions,
  songs,
  storageObjects,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  audioJobInputSchema,
  DERIVATIVE_CONTENT_TYPE,
  generateWaveformPeaks,
  measureLoudness,
  transcodeStreamingDerivative,
  validateAudio,
  variantOf,
  withTempWorkspace,
  DEFAULT_TEMP_BUDGET_BYTES,
  type AudioJobInput,
  type Capabilities,
  type LoudnessResult,
} from '@youandfriends/media';
import { derivativeObjectKey, type ObjectTransfer } from '@youandfriends/storage';
import {
  PROCESSING_FAILURE_MESSAGES,
  WAVEFORM_CONTENT_TYPE,
  type ProcessingFailureKind,
} from '@youandfriends/contracts';
import { and, eq, sql } from 'drizzle-orm';

/**
 * The audio pipeline, orchestrated (task `064`).
 *
 * download original → probe → loudness → streaming derivative → waveform peaks → upload →
 * one transaction recording the result → notify.
 *
 * Every step below is either read-only or idempotent, because every step may run twice:
 *
 * - **A derivative row is found before it is made.** One row per (version, kind, variant) — the
 *   unique index — and its id names its object (`derivativeObjectKey`). A retry writes the same
 *   key, so an upload that happened before a crash is replaced, never orphaned beside a second.
 * - **A derivative is recorded as soon as it exists**, in its own small transaction with its
 *   storage object. A retry after the stream was recorded skips the transcode entirely.
 * - **The version's analysis and the job's completion commit together.** Nothing reads
 *   "complete" unless everything complete depends on is already there.
 *
 * Nothing here is a mock. Tests run this exact function with real ffmpeg and a real Postgres;
 * only the queue in front of it and the bucket behind it are substituted (ADR 0002).
 */

export const PIPELINE_STAGES = [
  'download',
  'validate',
  'loudness',
  'stream_uploaded',
  'stream_recorded',
  'waveform_uploaded',
  'waveform_recorded',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The whole job, beginning to end. ffmpeg's own per-stage timeouts sit inside this. */
export const JOB_TIMEOUT_MS = 55 * 60_000;
export const MAX_ATTEMPTS = 4;

export type MediaNotificationSink = (event: {
  readonly event: Extract<NotificationEvent, 'version.processed' | 'version.processing_failed'>;
  readonly workspaceId: string;
  readonly assetVersionId: string;
}) => Promise<void>;

export interface PipelineDeps {
  readonly db: DirectDatabase;
  readonly originals: Pick<ObjectTransfer, 'downloadToFile'>;
  readonly derivatives: Pick<ObjectTransfer, 'uploadFile'>;
  /** Recorded on each derivative's `storage_objects` row. */
  readonly derivativesBucket: string;
  /** `YOUANDFRIENDS_DERIVATIVE_BITRATE`. */
  readonly bitrate: string;
  /** The capability probe (task `060`). Runs before any work; a failure fails the attempt loudly. */
  readonly capabilities: () => Promise<Capabilities>;
  readonly notify?: MediaNotificationSink | undefined;
  readonly timeoutMs?: number | undefined;
  readonly tempBudgetBytes?: number | undefined;
  readonly tempPrefix?: string | undefined;
  readonly newId?: (() => string) | undefined;
  /**
   * Called after each stage. The seam a test uses to stop a job partway through, the way a
   * worker losing its machine would — and nothing else.
   */
  readonly afterStage?: ((stage: PipelineStage) => Promise<void>) | undefined;
}

export interface Attempt {
  /** 1-based, as the queue counts it. */
  readonly number: number;
  readonly maxAttempts: number;
  readonly runId?: string | undefined;
}

export type PipelineOutcome =
  | { readonly status: 'complete' }
  /** The file is not usable audio. A fact about the file, recorded, and never retried. */
  | { readonly status: 'rejected'; readonly reason: string }
  /** Nothing to do: already complete, or the version is gone. */
  | { readonly status: 'skipped'; readonly reason: string };

/** A failure no retry can fix. The Trigger.dev task maps it to `AbortTaskRunError`. */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}

export class JobTimeoutError extends Error {
  constructor(readonly limitMs: number) {
    super(`the job ran past its ${Math.round(limitMs / 1000)} second limit`);
    this.name = 'JobTimeoutError';
  }
}

interface Source {
  readonly objectKey: string;
  readonly sizeBytes: number;
}

export async function processAudioVersion(
  deps: PipelineDeps,
  payload: unknown,
  attempt: Attempt,
): Promise<PipelineOutcome> {
  // Parsed here even though the dispatcher parsed it too: the payload crossed a queue that may
  // have been written by a different deploy of this code.
  const parsed = audioJobInputSchema.safeParse(payload);
  if (!parsed.success) throw new NonRetryableJobError('the job payload is malformed');
  const input = parsed.data;

  // Before anything is read or written. A worker whose ffmpeg cannot make the derivative must say
  // so now, rather than after downloading a 2 GB master — or, worse, after producing a file.
  const capabilities = await deps.capabilities();
  if (capabilities.aacEncoder === null) throw new Error('no AAC encoder in this ffmpeg build');

  const started = Date.now();
  const limitMs = deps.timeoutMs ?? JOB_TIMEOUT_MS;
  const remaining = () => {
    const left = limitMs - (Date.now() - started);
    if (left <= 0) throw new JobTimeoutError(limitMs);
    return left;
  };

  const begun = await beginAttempt(deps, input, attempt);
  if (begun.status === 'skipped') return begun;

  try {
    const outcome = await run(deps, input, begun.source, capabilities.aacEncoder, remaining);
    if (outcome.status === 'complete') {
      await deps.notify?.({
        event: 'version.processed',
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
      });
    }
    return outcome;
  } catch (error) {
    const final = error instanceof NonRetryableJobError || attempt.number >= attempt.maxAttempts;
    await recordFailure(deps.db, input, describeFailure(error), final);
    if (final) {
      await deps.notify?.({
        event: 'version.processing_failed',
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
      });
    }
    throw error;
  }
}

/**
 * Claim the job for this attempt, reading what to process from the rows rather than the payload.
 *
 * The payload's object key must match the version's own. A queued message that names some other
 * object — a bug, or a payload crafted by whoever can write to the queue — is refused: the worker
 * reads only the bytes the database says belong to this version.
 */
async function beginAttempt(
  deps: PipelineDeps,
  input: AudioJobInput,
  attempt: Attempt,
): Promise<{ status: 'skipped'; reason: string } | { status: 'running'; source: Source }> {
  return deps.db.transaction(async (tx) => {
    const [version] = await tx
      .select({ objectKey: storageObjects.key, sizeBytes: storageObjects.sizeBytes })
      .from(assetVersions)
      .innerJoin(
        storageObjects,
        and(
          eq(storageObjects.id, assetVersions.storageObjectId),
          eq(storageObjects.workspaceId, assetVersions.workspaceId),
        ),
      )
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
    if (version === undefined) {
      return { status: 'skipped', reason: 'the version no longer exists' } as const;
    }
    if (version.objectKey !== input.objectKey) {
      throw new NonRetryableJobError('the payload names an object this version does not own');
    }

    await tx
      .insert(mediaJobs)
      .values({
        id: (deps.newId ?? newUlid)(),
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
      })
      .onConflictDoNothing();
    // Locked, so two runs of one job — a retry racing a replay — serialize here rather than both
    // deciding the job is theirs.
    const [job] = await tx
      .execute<{ state: string }>(
        sql`select state from media_jobs
          where workspace_id = ${input.workspaceId} and asset_version_id = ${input.assetVersionId}
          for update`,
      )
      .then((result) => result.rows);
    if (job?.state === 'complete') {
      return { status: 'skipped', reason: 'already complete' } as const;
    }

    await tx
      .update(mediaJobs)
      .set({
        state: 'running',
        attempts: sql`${mediaJobs.attempts} + 1`,
        runId: attempt.runId ?? null,
        lastError: null,
        startedAt: sql`now()`,
        finishedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mediaJobs.workspaceId, input.workspaceId),
          eq(mediaJobs.assetVersionId, input.assetVersionId),
        ),
      );
    await tx
      .update(assetVersions)
      .set({ processingState: 'running', processingError: null })
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
    return { status: 'running', source: version } as const;
  });
}

async function run(
  deps: PipelineDeps,
  input: AudioJobInput,
  source: Source,
  encoder: 'aac' | 'libfdk_aac',
  remaining: () => number,
): Promise<PipelineOutcome> {
  const budget = deps.tempBudgetBytes ?? DEFAULT_TEMP_BUDGET_BYTES;
  if (source.sizeBytes > budget) {
    throw new NonRetryableJobError(
      `the original is ${source.sizeBytes} bytes, over this worker's ${budget} byte scratch budget`,
    );
  }
  const after = deps.afterStage ?? (async () => undefined);
  const operations = new Set(input.operations);

  // `withTempWorkspace` removes the directory on every exit — success, rejection, a thrown error,
  // a timeout. A 2 GB master left behind per failure fills a worker's disk within a handful.
  return withTempWorkspace(
    async (scratch) => {
      const original = join(scratch.dir, 'original');
      await deps.originals.downloadToFile(source.objectKey, original, {
        // The recorded size, not the payload's: an object that grew is not the one we recorded.
        maxBytes: source.sizeBytes,
        signal: AbortSignal.timeout(remaining()),
      });
      await after('download');

      const validation = await validateAudio(original, { timeoutMs: remaining() });
      if (!validation.ok) {
        await recordRejection(deps.db, input, validation.failure, validation.reason);
        return { status: 'rejected', reason: validation.reason } as const;
      }
      const probe = validation.probe;
      await after('validate');

      const loudness = operations.has('loudness')
        ? await measureLoudness(original, probe.durationMs, { timeoutMs: remaining() })
        : null;
      await after('loudness');

      if (operations.has('stream_derivative')) {
        const recipe = { bitrate: deps.bitrate, encoder };
        await produceDerivative(deps, input, 'streaming_audio', variantOf(recipe), {
          contentType: DERIVATIVE_CONTENT_TYPE,
          make: async () => {
            const output = join(scratch.dir, 'stream.m4a');
            await transcodeStreamingDerivative(original, output, recipe, {
              timeoutMs: remaining(),
            });
            await scratch.assertWithinBudget();
            return output;
          },
          uploaded: () => after('stream_uploaded'),
        });
        await after('stream_recorded');
      }

      if (operations.has('waveform')) {
        await produceDerivative(deps, input, 'waveform_peaks', 'yfwp-v1', {
          contentType: WAVEFORM_CONTENT_TYPE,
          make: async () => {
            const { bytes } = await generateWaveformPeaks(original, probe, {
              timeoutMs: remaining(),
            });
            const output = join(scratch.dir, 'peaks.yfwp');
            await writeFile(output, bytes, { flag: 'wx' });
            return output;
          },
          uploaded: () => after('waveform_uploaded'),
        });
        await after('waveform_recorded');
      }

      remaining();
      await recordComplete(deps.db, input, probe, loudness);
      return { status: 'complete' } as const;
    },
    { budgetBytes: budget, prefix: deps.tempPrefix ?? 'youandfriends-audio-' },
  );
}

/**
 * Make one derivative unless it already exists, upload it to its row's own key, and record it.
 *
 * The row is created (or found) *before* the upload so its id — and therefore the object key —
 * is fixed before any bytes move. Whatever point a previous attempt died at, this attempt writes
 * the same key and the same row.
 */
async function produceDerivative(
  deps: PipelineDeps,
  input: AudioJobInput,
  kind: 'streaming_audio' | 'waveform_peaks',
  variant: string,
  steps: {
    readonly contentType: string;
    readonly make: () => Promise<string>;
    readonly uploaded: () => Promise<void>;
  },
): Promise<void> {
  const where = and(
    eq(derivatives.workspaceId, input.workspaceId),
    eq(derivatives.assetVersionId, input.assetVersionId),
    eq(derivatives.kind, kind),
    eq(derivatives.variant, variant),
  );
  await deps.db
    .insert(derivatives)
    .values({
      id: (deps.newId ?? newUlid)(),
      workspaceId: input.workspaceId,
      assetVersionId: input.assetVersionId,
      kind,
      variant,
      processingState: 'running',
    })
    .onConflictDoNothing();
  const [row] = await deps.db.select().from(derivatives).where(where);
  if (row === undefined) throw new Error(`derivative ${kind}/${variant} vanished`);
  if (row.processingState === 'complete' && row.storageObjectId !== null) return;

  const key = derivativeObjectKey(input.workspaceId, row.id);
  const path = await steps.make();
  await deps.derivatives.uploadFile(key, path, steps.contentType);
  await steps.uploaded();

  const { size, checksum } = await digest(path);
  await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: storageObjects.id, checksum: storageObjects.checksumSha256 })
      .from(storageObjects)
      .where(and(eq(storageObjects.bucket, deps.derivativesBucket), eq(storageObjects.key, key)));
    let objectId: string;
    if (existing === undefined) {
      objectId = (deps.newId ?? newUlid)();
      await tx.insert(storageObjects).values({
        id: objectId,
        workspaceId: input.workspaceId,
        bucket: deps.derivativesBucket,
        key,
        sizeBytes: size,
        checksumSha256: checksum,
        contentType: steps.contentType,
      });
    } else if (existing.checksum === checksum) {
      objectId = existing.id;
    } else {
      // A record for this key with other bytes: the object was replaced after it was recorded.
      // Storage objects are immutable, so the stale row goes and a true one replaces it — the
      // derivative is regenerable, and a row that misdescribes its object is worse than none.
      await tx.update(derivatives).set({ storageObjectId: null }).where(where);
      await tx.delete(storageObjects).where(eq(storageObjects.id, existing.id));
      objectId = (deps.newId ?? newUlid)();
      await tx.insert(storageObjects).values({
        id: objectId,
        workspaceId: input.workspaceId,
        bucket: deps.derivativesBucket,
        key,
        sizeBytes: size,
        checksumSha256: checksum,
        contentType: steps.contentType,
      });
    }
    await tx
      .update(derivatives)
      .set({ storageObjectId: objectId, processingState: 'complete', processingError: null })
      .where(where);
  });
}

/** Everything the version's page shows, and the job's completion, in one transaction. */
async function recordComplete(
  db: DirectDatabase,
  input: AudioJobInput,
  probe: {
    readonly durationMs: number;
    readonly codec: string;
    readonly channels: number;
    readonly sampleRateHz: number;
    readonly bitDepth: number | null;
  },
  loudness: LoudnessResult | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(assetVersions)
      .set({
        durationMs: probe.durationMs,
        codec: probe.codec,
        channels: probe.channels,
        sampleRateHz: probe.sampleRateHz,
        bitDepth: probe.bitDepth,
        ...(loudness === null
          ? {}
          : {
              integratedLufs: loudness.integratedLufs,
              truePeakDb: loudness.truePeakDb,
              loudnessRangeLu: loudness.loudnessRangeLu,
              loudnessUnavailable: loudness.unavailable,
            }),
        processingState: 'complete',
        processingError: null,
      })
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
    // A song's duration is its current version's.
    await tx
      .update(songs)
      .set({ durationMs: probe.durationMs })
      .where(
        and(
          eq(songs.workspaceId, input.workspaceId),
          sql`${songs.currentVersionId} in (
            select ${mixVersions.id} from ${mixVersions}
            where ${mixVersions.workspaceId} = ${input.workspaceId}
              and ${mixVersions.assetVersionId} = ${input.assetVersionId})`,
        ),
      );
    await tx
      .update(mediaJobs)
      .set({ state: 'complete', lastError: null, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(mediaJobs.workspaceId, input.workspaceId),
          eq(mediaJobs.assetVersionId, input.assetVersionId),
        ),
      );
  });
}

/**
 * Not audio. Final: no retry turns a text file into a song. The version gets the explanation a
 * person can act on; the tool's own words, which can carry paths, stay in the job row.
 */
async function recordRejection(
  db: DirectDatabase,
  input: AudioJobInput,
  failure: ProcessingFailureKind,
  reason: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(assetVersions)
      .set({ processingState: 'failed', processingError: PROCESSING_FAILURE_MESSAGES[failure] })
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
    await tx
      .update(mediaJobs)
      .set({
        state: 'failed',
        lastError: `rejected: ${reason}`.slice(0, 500),
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mediaJobs.workspaceId, input.workspaceId),
          eq(mediaJobs.assetVersionId, input.assetVersionId),
        ),
      );
  });
}

/**
 * An attempt failed. With attempts left the job goes back to `queued` — the queue will run it
 * again, and the version still honestly reads "processing". Out of attempts, both say `failed`.
 */
async function recordFailure(
  db: DirectDatabase,
  input: AudioJobInput,
  message: string,
  final: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(mediaJobs)
      .set({
        state: final ? 'failed' : 'queued',
        lastError: message,
        finishedAt: final ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mediaJobs.workspaceId, input.workspaceId),
          eq(mediaJobs.assetVersionId, input.assetVersionId),
        ),
      );
    await tx
      .update(assetVersions)
      .set(
        final
          ? { processingState: 'failed', processingError: PROCESSING_FAILURE_MESSAGES.gave_up }
          : { processingState: 'queued' },
      )
      .where(
        and(
          eq(assetVersions.id, input.assetVersionId),
          eq(assetVersions.workspaceId, input.workspaceId),
        ),
      );
  });
}

/**
 * What is stored about a failure: the error's kind and a bounded message. Never a stack, and the
 * scratch directory's path is not interesting to anyone reading it later.
 */
export function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}`
    .replace(/\/[^\s'"]*youandfriends-audio-[^\s'"]*/g, '<scratch>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .slice(0, 500);
}

async function digest(path: string): Promise<{ size: number; checksum: string }> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { size: (await stat(path)).size, checksum: hash.digest('hex') };
}
