# 001 — Tooling and quality gates

**Phase:** Foundation · **Iteration:** one

## Objective

Make the quality bar executable. Wire Vitest, Testing Library, Prettier, ESLint flat config,
strict TypeScript project references, Turborepo pipelines, and a `release-check` script that
runs every gate in the correct order.

## User value

Indirect but real: it is the mechanism that keeps a working product working. Every later task
depends on being able to prove it did not break anything.

## Scope

- Vitest workspace config covering every package, with `@testing-library/react` and
  `jsdom` for component packages and `node` for server packages.
- Coverage reporting with a floor that starts low and ratchets; never a gate that tempts
  disabling.
- ESLint flat config in `packages/config`, extended by every workspace.
- Prettier with a shared config; format check in CI, format-on-save documented.
- Turborepo pipeline definitions with correct `dependsOn` and cache inputs/outputs.
- `pnpm release-check` running: format → lint → typecheck → unit → build.
- `pnpm test:watch` for development.

## Non-scope

- Playwright (task `120`), storage contract tests against MinIO (task `052`), media fixture
  tests (task `066`), Rust clippy (task `118`). Each is added to `release-check` by its own
  task — this task establishes the script and its ordering.
- GitHub Actions workflow (task `123`).

## Dependencies

`000`

## Files expected to change

```
package.json  turbo.json  vitest.workspace.ts  eslint.config.mjs  .prettierrc.json
packages/config/src/{eslint,tsconfig,vitest}/**
scripts/release-check.mjs
```

## Implementation notes

- `release-check` must fail fast and print which gate failed and the exact command to
  reproduce it locally. A gate that fails with an unreadable stack costs more than it saves.
- Turborepo cache inputs must include the config files themselves, or a config change will
  serve stale cached passes.
- Strict TypeScript includes `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` per
  ADR 0007. Enable them now, while the codebase is small.

## Security/privacy considerations

- Add `eslint-plugin-no-secrets` or equivalent to catch high-entropy string literals.
- The dependency audit step (`pnpm audit`) is wired here but is advisory until task `123`
  decides the failure threshold, so that a transitive advisory does not block all work.

## Acceptance criteria

- [x] `pnpm test` runs tests in every package and reports coverage.
- [x] `pnpm lint` fails on a deliberately introduced violation.
- [x] `pnpm typecheck` fails on a deliberately introduced type error.
- [x] `pnpm format:check` fails on misformatted input.
- [x] `pnpm release-check` runs all gates in order and names the failing gate.
- [x] Turborepo caches a second identical run (visible cache hit).
- [x] `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled repo-wide.

## Tests and validation commands

```bash
pnpm release-check
pnpm test -- --coverage
```

## Manual QA

1. Introduce a type error; confirm `typecheck` catches it. Revert.
2. Introduce a lint violation; confirm `lint` catches it. Revert.
3. Run `release-check` twice; confirm the second run is faster from cache.

## Rollback/compatibility

Config-only. Reverting restores the task `000` scaffold. No runtime impact.

## Status

`complete`

## Commit

_(not yet)_
