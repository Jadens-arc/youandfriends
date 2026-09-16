import preset from '@youandfriends/config/vitest/node';
import { defineConfig, mergeConfig } from 'vitest/config';

import { loadDatabaseEnv, REPO_ROOT } from './src/env-file';

/**
 * Database tests need a real Postgres server, and its URL is a credential, so it cannot live
 * in the repository. The same loader the migration commands use reads it from the
 * developer's `.env.test.local` or `.env.local`, or from the ambient environment in CI.
 *
 * When nothing supplies one, the suites that need a server skip **loudly** rather than
 * passing quietly (CLAUDE.md §7).
 */
loadDatabaseEnv(REPO_ROOT);

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      // A scratch database per file is created and dropped over the network. The default 5 s
      // is not enough for that, and a timeout there reads as a product failure.
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
);
