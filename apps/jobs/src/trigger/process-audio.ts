import { AbortTaskRunError, logger, task } from '@trigger.dev/sdk';
import { AUDIO_TASK_ID } from '@youandfriends/media';

import {
  describeFailure,
  JOB_TIMEOUT_MS,
  MAX_ATTEMPTS,
  NonRetryableJobError,
  processAudioVersion,
} from '../pipeline';
import { workerDeps } from '../worker';

/**
 * The one audio task (ADR 0002, task `064`). All logic is in `processAudioVersion`; this maps it
 * onto Trigger.dev's retry and duration controls and nothing else.
 *
 * - `maxDuration` is the platform's hard stop, set just above the pipeline's own deadline so the
 *   pipeline normally fails first and gets to record why.
 * - A `NonRetryableJobError` — not audio, a malformed payload, a payload naming someone else's
 *   object — becomes `AbortTaskRunError`, so the queue does not spend retries on it.
 * - Logs carry the ids and the sanitized failure only: never the payload's object key alongside a
 *   URL, never a credential (`docs/THREAT_MODEL.md` T3).
 */
export const processAudio = task({
  id: AUDIO_TASK_ID,
  maxDuration: Math.ceil(JOB_TIMEOUT_MS / 1000) + 300,
  queue: { concurrencyLimit: 2 },
  machine: 'medium-1x',
  retry: {
    maxAttempts: MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 10 * 60_000,
    randomize: true,
  },
  run: async (payload: unknown, { ctx }) => {
    try {
      const outcome = await processAudioVersion(workerDeps(), payload, {
        number: ctx.attempt.number,
        maxAttempts: MAX_ATTEMPTS,
        runId: ctx.run.id,
      });
      logger.info('audio job finished', { runId: ctx.run.id, status: outcome.status });
      return outcome;
    } catch (error) {
      logger.error('audio job attempt failed', {
        runId: ctx.run.id,
        attempt: ctx.attempt.number,
        failure: describeFailure(error),
      });
      if (error instanceof NonRetryableJobError) throw new AbortTaskRunError(error.message);
      throw error;
    }
  },
});
