# ADR 0007: pnpm workspaces + Turborepo, TypeScript strict throughout

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

The product spans a Next.js web app, Trigger.dev job definitions, a Tauri desktop agent, and
seven shared packages. Several of these share Zod contracts, the storage driver, and media
logic. The build prompt specifies pnpm workspaces and Turborepo.

## Decision

**pnpm workspaces** for dependency management, **Turborepo** for task orchestration and
caching, **TypeScript strict** everywhere with no exceptions granted by default.

- Internal packages are consumed as source (`exports` pointing at `src`), transpiled by the
  consumer. No build step between packages during development, so a change in
  `packages/contracts` is immediately visible in `apps/web` without a watch process.
- `packages/config` owns the tsconfig bases, the ESLint flat config, and the Tailwind preset.
  A rule changes in one place.
- Turborepo pipelines declare real dependencies so `pnpm test` at the root runs the right
  things in the right order with caching.
- Strict mode includes `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. These are
  irritating on day one and load-bearing by month three.

## Consequences

**Easier:** One install, one lockfile, atomic cross-package changes in a single commit — which
matters because the one-task-per-commit protocol requires a task's full change to land
together. pnpm's content-addressed store keeps disk and install time reasonable.

**Harder:** Tauri's Rust toolchain sits outside the Node graph; `apps/sync-mac` has its own
Cargo workspace and its quality gates (clippy, `cargo test`) run as separate pipeline steps.
Strict TypeScript with `noUncheckedIndexedAccess` requires genuine care around array access.

**Accepted:** Consuming internal packages as source means consumers must transpile them —
configured once in `next.config.ts` via `transpilePackages` and in the Vitest config.

## Alternatives considered

**npm/yarn workspaces** — adequate, but pnpm's strictness about phantom dependencies is
valuable in a monorepo with a deliberate dependency direction (see `docs/ARCHITECTURE.md` §3).

**Nx** — more capable than Turborepo for large graphs, but heavier configuration than this
repository needs.

**Separate repositories** — the Tauri agent and the web app could live apart, but they share
Zod contracts for the upload protocol, and keeping those in lockstep across repos is exactly
the coordination cost a monorepo removes.

## Pinned toolchain and a build-environment gotcha

Versions at authoring time: Next 16.3.x, React 19.2.x, TypeScript 5.9.x, ESLint 9.x with
typescript-eslint 8.x, Vitest 3.x, Turborepo 2.x, Tailwind 4.x.

TypeScript 7 and ESLint 10 were both available and both deliberately declined. TypeScript 7 is
the native port; Next 16 currently expects the TypeScript 6 compiler API and refuses 7 unless
`experimental.useTypeScriptCli` is set, and typescript-eslint 8 does not yet support it.
ESLint 10 is too new for reliable flat-config plugin support. Both are worth revisiting once
the ecosystem catches up; neither is load-bearing for anything we are building.

### `next build` requires `NODE_ENV=production`

**This one is worth knowing before it costs you an afternoon.** If `NODE_ENV` is set to
`development` in the environment, `next build` still compiles successfully and then fails
during prerendering with a misleading error:

```
TypeError: Cannot read properties of null (reading 'useContext')
Error occurred prerendering page "/_global-error"
```

The error names React and a Next-internal page, so it reads convincingly as a duplicate-React
or module-resolution problem. It is neither. Next emits a quiet
`⚠ You are using a non-standard "NODE_ENV" value` line well above the failure, and that line
is the actual diagnosis.

The build and start scripts therefore set `NODE_ENV=production` explicitly via `cross-env`,
rather than inheriting whatever the surrounding environment happens to have. Some CI images
and container environments export `NODE_ENV=development` by default, so this is not a
hypothetical.

If a future build fails with a null `useContext` during prerender, check `NODE_ENV` first.
