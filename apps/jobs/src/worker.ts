import { parseServerEnv } from '@youandfriends/config';
import { newUlid } from '@youandfriends/contracts';
import {
  createDirectClient,
  recordProcessingNotification,
  type DirectDatabase,
} from '@youandfriends/db';
import { assertCapabilities, type Capabilities } from '@youandfriends/media';
import { createR2Transfer, r2ConfigFrom } from '@youandfriends/storage';

import type { MediaNotificationSink, PipelineDeps } from './pipeline';

/**
 * The worker's real dependencies, from its environment. Built once per process.
 *
 * Every integration here is the real one (CLAUDE.md §7): Postgres over a direct connection, R2
 * for both buckets, the ffmpeg the build extension installed. A missing variable throws with its
 * name when the first job arrives, rather than a job completing against nothing.
 */
let deps: PipelineDeps | null = null;
let probed: Promise<Capabilities> | null = null;

export function workerDeps(): PipelineDeps {
  if (deps !== null) return deps;
  const env = parseServerEnv();
  const derivativesConfig = r2ConfigFrom(env, 'derivatives');
  const db = createDirectClient(env, { max: 2 }).db;
  deps = {
    db,
    notify: processingNotifier(db),
    originals: createR2Transfer(r2ConfigFrom(env, 'originals')),
    derivatives: createR2Transfer(derivativesConfig),
    derivativesBucket: derivativesConfig.bucket,
    bitrate: env.YOUANDFRIENDS_DERIVATIVE_BITRATE,
    capabilities: () => {
      // Memoized on success only: a failed probe is retried by the next job instead of being
      // remembered, so fixing the image does not also require restarting every worker.
      probed ??= assertCapabilities().catch((error: unknown) => {
        probed = null;
        throw error;
      });
      return probed;
    },
  };
  return deps;
}

/**
 * A finished or failed version is news to whoever uploaded it (task `095`). A failure to record
 * the notification is logged and does not fail the job: the version was processed either way.
 */
export function processingNotifier(db: DirectDatabase): MediaNotificationSink {
  return async (event) => {
    try {
      await recordProcessingNotification(db, { ...event, id: newUlid() });
    } catch (error) {
      console.error('processing notification failed', {
        event: event.event,
        assetVersionId: event.assetVersionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
