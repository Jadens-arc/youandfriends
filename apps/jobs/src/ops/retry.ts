import {
  listRetryableMediaJobs,
  resetMediaJobForRetry,
  type DirectDatabase,
  type MediaJobRow,
} from '@youandfriends/db';
import type { JobDispatcher } from '@youandfriends/media';

import { enqueueMediaJob, type EnqueueResult } from '../enqueue';
import { JOB_TIMEOUT_MS } from '../pipeline';

/**
 * `ops:media:retry` (task `064`, `docs/OPERATIONS.md` §10): send failed or stranded jobs again.
 *
 * Planning is a read; executing resets each job to `queued` and dispatches it under a *new*
 * idempotency key — the queue remembers the old key, and replaying it would hand back the failed
 * run instead of starting one. The new key is derived from the job's attempt count and last
 * update, so two operators retrying the same job at the same moment still collapse into one run.
 *
 * Never touches a `complete` job, or a `running` one young enough to still have a live worker.
 * Reprocessing finished work is a different operation with different consequences, and not one
 * this script offers.
 */
export type RetrySelection =
  | { readonly kind: 'version'; readonly assetVersionId: string }
  | {
      readonly kind: 'all';
      /**
       * `failed` only, or also stranded jobs: `queued` ones nothing picked up within
       * {@link STRANDED_AFTER_MS}, and `running` ones untouched for longer than any attempt lasts.
       */
      readonly includeStranded: boolean;
      readonly workspaceId?: string | undefined;
      readonly limit?: number | undefined;
    };

/** A queued job younger than this is waiting its turn, not stranded. */
export const STRANDED_AFTER_MS = 15 * 60_000;

/**
 * A running job untouched for longer than this has lost its worker: past the pipeline's own
 * deadline *and* Trigger.dev's `maxDuration`, so no live attempt can still be writing to it.
 */
export const ABANDONED_AFTER_MS = JOB_TIMEOUT_MS + 15 * 60_000;

export async function planMediaRetry(
  db: DirectDatabase,
  selection: RetrySelection,
  now: Date = new Date(),
): Promise<MediaJobRow[]> {
  const runningBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
  if (selection.kind === 'version') {
    return listRetryableMediaJobs(db, {
      states: ['failed', 'queued', 'running'],
      assetVersionId: selection.assetVersionId,
      runningBefore,
    });
  }
  return listRetryableMediaJobs(db, {
    states: selection.includeStranded ? ['failed', 'queued', 'running'] : ['failed'],
    workspaceId: selection.workspaceId,
    queuedBefore: new Date(now.getTime() - STRANDED_AFTER_MS),
    runningBefore,
    limit: selection.limit,
  });
}

export interface RetryReport {
  readonly jobId: string;
  readonly assetVersionId: string;
  readonly result: EnqueueResult | { readonly dispatched: false; readonly reason: string };
}

export async function executeMediaRetry(
  db: DirectDatabase,
  dispatcher: JobDispatcher | null,
  plan: readonly MediaJobRow[],
  now: Date = new Date(),
): Promise<RetryReport[]> {
  const reports: RetryReport[] = [];
  const runningBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
  for (const job of plan) {
    const key = `retry-${job.attempts}-${job.updatedAt.getTime()}`;
    const reset = await resetMediaJobForRetry(db, job.workspaceId, job.assetVersionId, {
      runningBefore,
    });
    if (!reset) {
      reports.push({
        jobId: job.id,
        assetVersionId: job.assetVersionId,
        result: { dispatched: false, reason: 'the job changed state since it was planned' },
      });
      continue;
    }
    const result = await enqueueMediaJob(
      db,
      dispatcher,
      { workspaceId: job.workspaceId, assetVersionId: job.assetVersionId },
      { idempotencyKey: key },
    );
    reports.push({ jobId: job.id, assetVersionId: job.assetVersionId, result });
  }
  return reports;
}

export function describeRetryPlan(plan: readonly MediaJobRow[]): string {
  if (plan.length === 0) return 'No failed or stranded media jobs.';
  const lines = plan.map(
    (job) =>
      `  ${job.assetVersionId}  ${job.state.padEnd(6)}  attempts ${job.attempts}  ` +
      `${job.lastError ?? ''}`.trimEnd(),
  );
  return [`${plan.length} media job(s) to retry:`, ...lines].join('\n');
}
