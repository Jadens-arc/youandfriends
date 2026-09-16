import preset from '@youandfriends/config/vitest/react';
import { defineConfig, mergeConfig } from 'vitest/config';

// The design system is fully tested, so it gates itself well above the shared baseline.
export default mergeConfig(
  preset,
  defineConfig({
    test: {
      coverage: {
        thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  }),
);
