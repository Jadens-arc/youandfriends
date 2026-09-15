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
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
});

export default nodePreset;
