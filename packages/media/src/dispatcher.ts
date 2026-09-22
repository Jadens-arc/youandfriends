/**
 * How work gets scheduled (ADR 0002).
 *
 * `apps/web` never imports Trigger.dev. It holds a `JobDispatcher` and calls it, so the queue is
 * one swappable edge rather than an import spread through route handlers — which is what makes
 * the self-hosted `WorkerDispatcher` in ADR 0002's consequences a future possibility rather than
 * a rewrite.
 *
 * **The pipeline is never mocked; only its scheduling is.** `InlineDispatcher` runs the real
 * work, synchronously, in-process. That distinction is the whole reason the seam is here: a test
 * that substituted fake *processing* would prove nothing about the thing that touches someone's
 * master, whereas a test that substitutes the *queue* still exercises every line that matters.
 */
import { audioJobInputSchema, type AudioJobInput, type JobHandle } from './types';

export interface JobDispatcher {
  enqueueAudioProcessing(input: AudioJobInput, idempotencyKey: string): Promise<JobHandle>;
}

/** A queue was asked to take work and would not. */
export class DispatchError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

/**
 * The transport Trigger.dev provides, narrowed to what this dispatcher uses.
 *
 * Injected rather than imported. `apps/jobs` and the Trigger.dev SDK arrive in task `064`;
 * `packages/media` defines the payload and the call shape, and that package supplies the client.
 * The mapping below — which task id, how the idempotency key travels, what a handle looks like —
 * is this package's real logic and is tested as such. What is deferred is the socket, not the
 * behaviour.
 */
export interface TriggerClient {
  trigger(
    taskId: string,
    payload: unknown,
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
}

/** The task id `apps/jobs` registers. One string, in one place, referenced by both sides. */
export const AUDIO_TASK_ID = 'process-audio';

/**
 * The real dispatcher.
 *
 * Requires a client. It does **not** fall back to running inline, or to returning a handle for
 * work nobody queued, when one is absent — a dispatcher that silently degrades to doing nothing
 * is how a queue outage becomes "your upload is still processing" forever.
 */
export class TriggerDispatcher implements JobDispatcher {
  constructor(private readonly client: TriggerClient) {
    if (client === undefined || client === null) {
      throw new DispatchError(
        'TriggerDispatcher needs a Trigger.dev client; task `064` supplies it from `apps/jobs`',
      );
    }
  }

  async enqueueAudioProcessing(input: AudioJobInput, idempotencyKey: string): Promise<JobHandle> {
    // Validated on the way out as well as on the way in. The worker parses it again on arrival,
    // but a payload that fails here fails now, with a caller to tell, rather than in a queue
    // consumer at 3am with nobody to tell.
    const payload = audioJobInputSchema.parse(input);
    assertIdempotencyKey(idempotencyKey);
    const key = scopedKey(payload, idempotencyKey);

    let result: { id: string };
    try {
      result = await this.client.trigger(AUDIO_TASK_ID, payload, { idempotencyKey: key });
    } catch (error) {
      // Rethrown, never swallowed into a fake handle. The caller records that the job was not
      // scheduled; the asset stays "processing" and a later run picks it up.
      throw new DispatchError(
        `could not enqueue audio processing for ${input.assetVersionId}`,
        error,
      );
    }

    return { id: result.id, status: 'queued', idempotencyKey };
  }
}

/** Runs the work. Supplied by whoever constructs the inline dispatcher. */
export type InlineRunner = (input: AudioJobInput) => Promise<void>;

/**
 * Runs the real pipeline synchronously, in-process.
 *
 * For tests and for a local environment with no queue. It is **not** a mock of the pipeline: the
 * runner it is given is the same code the worker runs. What it removes is the queue, the network
 * and the wait.
 *
 * Idempotency is honoured the way a queue would: a repeated key returns the first handle and does
 * not run the work twice. Without that, an inline test would pass against a dispatcher that
 * ignores idempotency entirely, and the difference would first appear in production.
 */
export class InlineDispatcher implements JobDispatcher {
  private readonly seen = new Map<string, { handle: JobHandle; payload: string }>();

  constructor(
    private readonly runner: InlineRunner,
    private readonly newId: () => string = defaultId,
  ) {}

  async enqueueAudioProcessing(input: AudioJobInput, idempotencyKey: string): Promise<JobHandle> {
    const payload = audioJobInputSchema.parse(input);
    assertIdempotencyKey(idempotencyKey);
    const key = scopedKey(payload, idempotencyKey);

    const existing = this.seen.get(key);
    if (existing !== undefined) {
      if (existing.payload !== JSON.stringify(payload)) {
        // Same key, different work. Silently returning the first handle would tell the caller
        // their job is queued while nothing runs it — the asset sits in "processing" forever.
        throw new DispatchError(
          `idempotency key ${idempotencyKey} was already used for different work`,
        );
      }
      return existing.handle;
    }

    const serialized = JSON.stringify(payload);
    let handle: JobHandle;
    try {
      await this.runner(payload);
      handle = { id: this.newId(), status: 'complete', idempotencyKey };
    } catch (error) {
      // Recorded as failed and remembered, so a replay reports the same failure rather than
      // retrying work that already went wrong — matching what the queue does with a used key.
      handle = { id: this.newId(), status: 'failed', idempotencyKey };
      this.seen.set(key, { handle, payload: serialized });
      throw new DispatchError(`inline audio processing failed for ${input.assetVersionId}`, error);
    }

    this.seen.set(key, { handle, payload: serialized });
    return handle;
  }
}

/**
 * Bind the caller's key to the work it describes.
 *
 * A bare key is an opaque string with no relationship to the payload, and Trigger.dev's keys are
 * project-global. A caller deriving one from something not globally unique — a filename, a song
 * title — would have workspace B's upload collide with workspace A's key: the job never runs, the
 * caller is handed A's run id, and B's asset stays unprocessed while the interface says
 * processing. Namespacing costs nothing and makes the collision impossible across workspaces.
 */
function scopedKey(payload: AudioJobInput, key: string): string {
  return `${payload.workspaceId}:${payload.assetVersionId}:${key}`;
}

/**
 * The key must be non-empty and bounded.
 *
 * An empty key is not "no idempotency" — it is one key shared by every job in the system, which
 * silently collapses unrelated work into a single handle.
 */
function assertIdempotencyKey(key: string): void {
  if (key === '' || key.trim() === '') {
    throw new DispatchError('an idempotency key is required; an empty one collides with every job');
  }
  if (key.length > 256) {
    throw new DispatchError(`idempotency key is ${key.length} characters, over the 256 limit`);
  }
}

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `inline-${counter}`;
}
