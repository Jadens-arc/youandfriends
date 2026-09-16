import preset from '@youandfriends/config/vitest/react';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          // Build-time transforms. `next/font/google` only resolves under the Next.js
          // compiler, so this module cannot be executed under Vitest — counting it would
          // measure the harness's limits rather than our test coverage. Its configuration
          // is asserted from source in `app/fonts.test.ts`, and its runtime behaviour is
          // verified by the build, which emits the woff2 files and fallback metrics.
          'app/fonts.ts',
          // Framework entry points with no logic of our own.
          'app/layout.tsx',
          'app/global-error.tsx',
          '**/*.config.*',
        ],
        // Ratchet (task 001 policy). Set to just below what the testable surface currently
        // reaches, now that unexecutable build-time modules are excluded rather than
        // dragging the number down. The shell lands in task `013` and will move this.
        thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  }),
);
