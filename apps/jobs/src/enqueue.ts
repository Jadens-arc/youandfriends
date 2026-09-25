import { isAudioKind, newUlid, type AssetKind } from '@youandfriends/contracts';
import {
  assetVersions,
  ensureMediaJob,
  loadMediaJobSource,
  recordMediaJobDispatched,
  recordMediaJobDispatchFailed,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';
import { DispatchError, type AudioOperation, type JobDispatcher } from '@youandfriends/media';

/** Every audio operation, for a new version of anything that carries sound. */
export const ALL_OPERATIONS: readonly AudioOperation[] = [
  'probe',
  'loudness',
  'stream_derivative',
  'waveform',
];

/**
 * What a version of this kind of asset needs from the worker (task `069`): the audio pipeline for
 * anything that carries sound, cover renditions for artwork, and nothing for the rest. Sending a
 * Logic project ZIP through the audio pipeline would only mark it "failed" for not being audio.
 */
export function operationsFor(kind: AssetKind): readonly AudioOperation[] | null {
  if (isAudioKind(kind)) return ALL_OPERATIONS;
  if (kind === 'artwork') return ['artwork'];
  return null;
}

export type EnqueueResult =
  | { readonly dispatched: true; readonly runId: string }
  | { readonly dispatched: false; readonly reason: string };

/**
 * Record a version's job and hand it to the queue (task `064`).
 *
 * The row is written **before** the dispatch, as `queued`. If the queue then refuses or cannot be
 * reached — or none is configured — the row stays exactly that, with the reason, and the version
 * keeps reading "processing": true, because it has not been processed. Nothing here ever writes
 * `complete`; only the worker that did the work does.
 *
 * Returns rather than throws for a dispatch failure: the caller is usually an upload that has
 * already succeeded, and a queue outage is not a reason to tell someone their upload failed.
 */
export async function enqueueMediaJob(
  db: DirectDatabase,
  dispatcher: JobDispatcher | null,
  target: { readonly workspaceId: string; readonly assetVersionId: string },
  options: { readonly idempotencyKey?: string; readonly newId?: () => string } = {},
): Promise<EnqueueResult> {
  const source = await loadMediaJobSource(db, target.workspaceId, target.assetVersionId);
  if (source === null) return { dispatched: false, reason: 'the version does not exist' };
  const operations = operationsFor(source.assetKind);
  if (operations === null) {
    // Nothing is derived from a project file: it is ready as uploaded. Recorded as such rather
    // than left `queued`, which would read "processing" for ever.
    await db
      .update(assetVersions)
      .set({ processingState: 'complete', processingError: null })
      .where(
        and(
          eq(assetVersions.id, target.assetVersionId),
          eq(assetVersions.workspaceId, target.workspaceId),
        ),
      );
    return { dispatched: false, reason: `nothing to process for a ${source.assetKind}` };
  }

  const job = await ensureMediaJob(db, { id: (options.newId ?? newUlid)(), ...target });
  if (job.state === 'complete' || job.state === 'running') {
    return { dispatched: false, reason: `the job is already ${job.state}` };
  }

  if (dispatcher === null) {
    const reason = 'no job queue is configured (TRIGGER_SECRET_KEY is not set)';
    await recordMediaJobDispatchFailed(db, target.workspaceId, target.assetVersionId, reason);
    return { dispatched: false, reason };
  }

  try {
    const handle = await dispatcher.enqueueAudioProcessing(
      {
        workspaceId: source.workspaceId,
        assetVersionId: source.assetVersionId,
        objectKey: source.objectKey,
        sizeBytes: source.sizeBytes,
        operations: [...operations],
      },
      options.idempotencyKey ?? `process-${target.assetVersionId}`,
    );
    await recordMediaJobDispatched(db, target.workspaceId, target.assetVersionId, handle.id);
    return { dispatched: true, runId: handle.id };
  } catch (error) {
    if (!(error instanceof DispatchError)) throw error;
    await recordMediaJobDispatchFailed(
      db,
      target.workspaceId,
      target.assetVersionId,
      error.message,
    );
    return { dispatched: false, reason: error.message };
  }
}
