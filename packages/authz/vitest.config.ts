import { loadDatabaseEnv, REPO_ROOT } from '@youandfriends/db/env-file';
import preset from '@youandfriends/config/vitest/node';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * The same connection-string lookup the database package uses, so the two cannot disagree
 * about which server they are pointed at. Suites needing one skip loudly without it.
 */
loadDatabaseEnv(REPO_ROOT);

export default mergeConfig(
  preset,
  defineConfig({
    test: { testTimeout: 30_000, hookTimeout: 60_000 },
  }),
);
