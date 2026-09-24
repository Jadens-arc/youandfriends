import { parseServerEnv } from '@youandfriends/config';
import { createDirectClient } from '@youandfriends/db';
import { assertCapabilities, type Capabilities } from '@youandfriends/media';
import { createR2Transfer, r2ConfigFrom } from '@youandfriends/storage';

import type { PipelineDeps } from './pipeline';

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
  deps = {
    db: createDirectClient(env, { max: 2 }).db,
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
