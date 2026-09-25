/**
 * The contract between whoever asks for audio work and whoever does it.
 *
 * Shared by `apps/web` (which enqueues) and `apps/jobs` (which runs), so neither imports the
 * other and the payload has exactly one definition. Validated with Zod at both ends: a job
 * payload crosses a process boundary and sometimes a queue that outlives a deploy, so the worker
 * reading it may be a different version of this code than the one that wrote it.
 */
import { z } from 'zod';

/** What the pipeline can be asked to do to one uploaded object. */
export const audioOperationSchema = z.enum([
  /** ffprobe metadata only. Cheap, and the prerequisite for everything else. */
  'probe',
  /** EBU R128 loudness (task `061`). */
  'loudness',
  /** The AAC streaming derivative (ADR 0004, task `062`). */
  'stream_derivative',
  /** Waveform peaks for the player (task `063`). */
  'waveform',
  /** Square JPEG renditions of cover art (task `069`). Only for artwork; never with the above. */
  'artwork',
]);
export type AudioOperation = z.infer<typeof audioOperationSchema>;

/**
 * A unit of audio work.
 *
 * **Keys, not URLs.** The job is told which stored object to read by its key and fetches it with
 * the storage driver at run time. A presigned URL in a queue payload is a bearer credential
 * sitting in a durable store, readable by anyone who can see the queue and still valid when they
 * do (`docs/THREAT_MODEL.md` T3). The key alone grants nothing.
 */
export const audioJobInputSchema = z.object({
  workspaceId: z.string().min(1),
  assetVersionId: z.string().min(1),
  /** The stored original. Server-issued and opaque; see `packages/storage/src/keys.ts`. */
  objectKey: z.string().min(1),
  operations: z.array(audioOperationSchema).min(1),
  /** Bytes, as recorded at upload. Lets a worker refuse before it downloads. */
  sizeBytes: z.number().int().positive(),
});
export type AudioJobInput = z.infer<typeof audioJobInputSchema>;

export const jobStatusSchema = z.enum(['queued', 'running', 'complete', 'failed']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/**
 * What the caller gets back when it enqueues.
 *
 * `queued` means queued. **It never means complete** (CLAUDE.md §7): if the queue is unreachable
 * the dispatcher throws, and the caller reports that a job could not be scheduled. A handle
 * claiming `complete` for work nobody has done is the specific lie this product must not tell
 * about someone's song.
 */
export interface JobHandle {
  readonly id: string;
  readonly status: JobStatus;
  /** Echoed back so a caller can prove a replay got the same job rather than a second one. */
  readonly idempotencyKey: string;
}

export const probeResultSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  codec: z.string(),
  channels: z.number().int().positive(),
  sampleRateHz: z.number().int().positive(),
  bitDepth: z.number().int().positive().nullable(),
  formatName: z.string().nullable(),
  bitRate: z.number().nullable(),
  audioStreamCount: z.number().int().nonnegative(),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;
