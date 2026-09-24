import 'server-only';

import { loggerForEnv, parseServerEnv } from '@youandfriends/config';
import { triggerClientFrom } from '@youandfriends/jobs/client';
import { enqueueMediaJob } from '@youandfriends/jobs/enqueue';
import { TriggerDispatcher, type JobDispatcher } from '@youandfriends/media';

import { transactionalDatabase } from '@/lib/database';

/**
 * Queue a new version's processing from the web tier (task `064`).
 *
 * The web app holds a `JobDispatcher` and never imports Trigger.dev itself (ADR 0002). With no
 * `TRIGGER_SECRET_KEY` there is no dispatcher, and the job row says so while the version keeps
 * reading "processing" — the honest state of an upload nothing has processed.
 */
let dispatcher: JobDispatcher | null | undefined;

function mediaDispatcher(): JobDispatcher | null {
  if (dispatcher === undefined) {
    const client = triggerClientFrom(parseServerEnv());
    dispatcher = client === null ? null : new TriggerDispatcher(client);
  }
  return dispatcher;
}

/**
 * Never throws. The upload that called this has already been committed, and a queue that is
 * down is not a reason to report the upload as failed — the job row is left `queued` for
 * `ops:media:retry`, and the failure is logged under the request's correlation id.
 */
export function enqueueVersionProcessing(workspaceId: string, correlationId: string) {
  return async (assetVersionId: string): Promise<void> => {
    const log = loggerForEnv(parseServerEnv());
    try {
      const result = await enqueueMediaJob(transactionalDatabase(), mediaDispatcher(), {
        workspaceId,
        assetVersionId,
      });
      if (!result.dispatched) {
        log.warn('media job not dispatched', {
          correlationId,
          assetVersionId,
          reason: result.reason,
        });
      }
    } catch (error) {
      log.error('media job could not be recorded', {
        correlationId,
        assetVersionId,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
}
