import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Each workspace owns a `vitest.config.ts` that re-exports a shared preset from
 * `@youandfriends/config`, so environments stay consistent without duplication.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web'],
  },
});
