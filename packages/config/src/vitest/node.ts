import { defineConfig } from 'vitest/config';

/**
 * Vitest preset for server-side packages.
 *
 * Coverage thresholds start at zero and ratchet upward as real code lands. That is
 * deliberate: a floor set above what the codebase can currently reach is a floor people
 * disable, and a disabled gate is worse than an honest one (CLAUDE.md §5). Each task that
 * adds runtime code raises the floor to just below what it achieved.
 *
 * Barrel files and build tooling are excluded so the percentage describes runtime code
 * rather than re-exports and config.
 */
export const nodePreset = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/index.ts',
        'src/eslint/**',
        'src/vitest/**',
      ],
      // Ratchet (task 001 policy). Raised in task `002` once packages/config gained real
      // runtime code and reached 98% statements / 93% branches. Each task that adds runtime
      // code raises this to just below what it achieved.
      thresholds: { lines: 90, functions: 85, branches: 80, statements: 90 },
    },
  },
});

export default nodePreset;
