import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest preset for component workspaces: jsdom plus Testing Library matchers.
 *
 * `setup-react.ts` is resolved from this file rather than the consumer, so every component
 * package gets identical matchers and cleanup without copying a path.
 */
export const reactPreset = defineConfig({
  // `tsconfig` sets `jsx: preserve` because Next.js owns the transform in the app build.
  // Vitest has no such compiler in front of it, so it needs the automatic runtime here or
  // every render() fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [fileURLToPath(new URL('./setup-react.ts', import.meta.url))],
    include: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      exclude: ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.config.*', '**/.next/**'],
      // Baseline floor for component workspaces, sized to the weakest of them (apps/web,
      // which is mostly untested surface until the shell lands in task `013`). A package
      // that does better overrides this upward — see packages/ui/vitest.config.ts — so a
      // shared baseline never caps a well-tested package's gate.
      thresholds: { lines: 25, functions: 25, branches: 25, statements: 25 },
    },
  },
});

export default reactPreset;
