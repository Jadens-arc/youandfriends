# 005 — Close the dependency-boundary subpath hole and test the ID brand

**Phase:** Foundation · **Iteration:** one

## Objective

Close a documented hole in the `contracts` dependency boundary, add a regression guard so the
rule cannot silently stop working, and put a type-level test behind the branded-ID guarantee.

## User value

Indirect. Both items protect invariants that later tasks are entitled to rely on: that
`contracts` stays free of infrastructure, and that a `SongId` cannot be passed where a
`ProjectId` is expected.

## Scope

- Add a `patterns` group to the boundary rule covering `@youandfriends/db/*`,
  `@youandfriends/storage/*`, `@youandfriends/authz/*`, `@youandfriends/media/*`, and
  `@youandfriends/ui/*`. Today `paths` matches exact specifiers only.
- Consider restricting raw `pg` and `drizzle-orm` from `contracts` on the same reasoning.
- Add a regression guard so the boundary rule failing to fire is itself a test failure.
- Add a type-level test (`@ts-expect-error` or `expectTypeOf`) proving a cross-entity ID
  assignment does not compile.
- ~~Add the identifier negative cases the review found missing.~~ **Landed early in task
  `004`**: deriving the invalid ULIDs from the valid one was the fix for a lint failure
  there, and the extra cases came with it. Reverting them only to re-add them here would be
  churn. `contracts` now covers too-long, ambiguous `I`/`L`/`O`/`U`, lowercase, and
  leading/trailing whitespace.

## Non-scope

- The `no-unscoped-db` route-handler rule (task `022` owns it).
- Restructuring the boundary configuration beyond these additions.

## Dependencies

`003`

## Files expected to change

```
packages/config/src/eslint/boundaries.mjs
packages/config/src/eslint/boundaries.test.ts   (new — the regression guard)
packages/contracts/src/ids.test-d.ts            (new — type-level test)
packages/contracts/src/roles.test.ts
```

## Implementation notes

- The subpath hole is currently **latent, not live**: `packages/db` and `packages/storage`
  declare only a `"."` export, and `contracts` does not list them as dependencies, so
  typecheck would fail first. It becomes reachable the moment any infrastructure package adds
  a subpath export — which is exactly the kind of change nobody will connect to this rule.
- The regression guard matters more than the hole. The rule is configuration, currently
  proven only by a manual probe; if a later edit drops it, nothing fails. Run ESLint
  programmatically against a fixture that violates the boundary and assert it reports an
  error.
- The branded-ID guarantee is the one design claim in `contracts` with no evidence behind it.
  A runtime test cannot prove it, because the brand does not exist at runtime — it needs a
  type-level assertion.

## Security/privacy considerations

The dependency boundary is a structural control from ADR 0006 and `docs/ARCHITECTURE.md` §3.
Its value depends entirely on it actually firing, which is what the regression guard
establishes.

## Acceptance criteria

- [x] A subpath import such as `@youandfriends/db/schema` from `contracts` fails lint.
- [x] A regression guard fails if the boundary rule stops reporting.
- [x] A cross-entity ID assignment fails to compile, proven by a type-level test.
- [x] The additional identifier negative cases are covered (landed in task `004`).
- [x] `pnpm release-check` passes.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/config test
pnpm --filter @youandfriends/contracts test
pnpm lint
pnpm release-check
```

## Manual QA

1. Add a subpath import from `contracts`; confirm lint rejects it; remove it.
2. Assign a `WorkspaceId` to a `SongId`; confirm `pnpm typecheck` rejects it; revert.

## Rollback/compatibility

Lint configuration and tests only. No runtime impact.

## Status

`complete`

## Commit

_(not yet)_
