import { fileURLToPath } from 'node:url';

import preset from '@youandfriends/config/vitest/react';
import { loadDatabaseEnv, REPO_ROOT } from '@youandfriends/db/env-file';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Authentication provisions a `users` row, so its tests need a real Postgres — the same loader
 * the database package uses, reading the developer's `.env.test.local` or the ambient
 * environment in CI. When nothing supplies one, those suites skip **loudly** (CLAUDE.md §7).
 */
loadDatabaseEnv(REPO_ROOT);

export default mergeConfig(
  preset,
  defineConfig({
    resolve: {
      // Mirrors the `@/*` path in tsconfig.json. Without it a module under test resolves in
      // the Next build and fails in Vitest, which is a difference nobody wants to debug
      // twice.
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    test: {
      coverage: {
        exclude: [
          // Build-time transforms. `next/font/google` only resolves under the Next.js
          // compiler, so this module cannot be executed under Vitest — counting it would
          // measure the harness's limits rather than our test coverage. Its configuration
          // is asserted from source in `app/fonts.test.ts`, and its runtime behaviour is
          // verified by the build, which emits the woff2 files and fallback metrics.
          'app/fonts.ts',
          // The component showcase (task `015`). It is a fixture, not product code: its
          // uncalled surface is demo callbacks such as `onCheckedChange={() => {}}`, and
          // invoking them from a test would measure the fixture rather than the system.
          // What matters about it — that it covers every primitive, imports only the real
          // exports, and carries the anchors task `120` drives in a browser — is asserted
          // structurally in `app/%5Fshowcase/showcase.test.tsx`.
          'app/%5Fshowcase/**',
          // Framework entry points with no logic of our own.
          'app/layout.tsx',
          'app/global-error.tsx',
          // Clerk's own components with our tokens passed in. What is ours here is the token
          // values, asserted in `lib/auth/__tests__/appearance.test.ts`; what is Clerk's
          // cannot be rendered without a publishable key and a network.
          'app/(auth)/**',
          // The production Clerk read. It is `currentUser()` plus field selection; the
          // selection is asserted in `lib/auth/__tests__/identity.test.ts` against a stub
          // shaped like Clerk's user, and the wiring is what the build verifies.
          'lib/auth/current-session.ts',
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
