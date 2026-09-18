# 059 — Typecheck the operational scripts

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Bring `packages/db/bin/**` — the scripts that migrate, seed, purge, and sweep — under the same
typechecking as the rest of the repository.

## User value

None directly. It closes the one hole through which a bug can reach the commands that destroy
user work without any gate noticing.

## Why this exists

Task `051` shipped `bin/uploads-sweep.mjs` with `r2ConfigFrom(env)` — a two-argument function
called with one. The omitted argument resolves to `'derivatives'`, so the sweep would have bound
its driver to the wrong bucket, asked it to abort uploads living in `originals`, received
`NoSuchUpload` for every one, and reclaimed nothing — while exiting non-zero with errors that
read like a transient R2 problem. The job whose entire purpose is to stop billed parts
accumulating would have accumulated them silently.

**No gate could have caught it.** `packages/db/tsconfig.json` includes `src/**/*.ts` only, so
`bin/**` is typechecked by nothing; lint does not resolve cross-package call signatures; the
sweep's thirteen tests inject the aborter and never construct a driver; and the manual run
against a local database failed for want of R2 credentials, which masked it. A security review
found it by reading. That is not a control.

This is the third defect this build has shipped into operator tooling (`006` covered the first
two), and operator tooling is where the purge job lives.

## Scope

- `allowJs` + `checkJs` + `allowImportingTsExtensions` for `packages/db/bin/**/*.mjs`, most
  simply as a second tsconfig that the package's `typecheck` script also runs.
- Fix what it finds. As of this writing: 27 errors — 10 × TS5097 (`.ts` import extensions),
  the rest TS7006 implicit-`any` on argument-parsing helpers in `migrate.mjs`, `migrate-dry.mjs`,
  `purge.mjs`, `seed.mjs` and `uploads-sweep.mjs`.
- Whatever equivalent applies to `apps/sync-mac` scripts if the same hole exists there.

## Non-scope

- Converting the scripts to TypeScript. They are `.mjs` run through `tsx`, and that is fine;
  this task only asks the compiler to look at them.
- Changing what any script does.

## Dependencies

`051`

## Files expected to change

```
packages/db/tsconfig.bin.json   (new)
packages/db/package.json        (typecheck script)
packages/db/bin/*.mjs           (annotations only)
```

## Implementation notes

- `allowImportingTsExtensions` requires `noEmit`, which the typecheck script already uses.
- The argument-parsing helpers (`has`, `value`) are duplicated across four scripts with the same
  implicit-`any` parameters. Annotating them in place is the smaller change; extracting them is
  a refactor this task does not need.
- Verify the gate works by reintroducing the original defect — `r2ConfigFrom(env)` with one
  argument — and confirming `pnpm typecheck` fails on it. A gate that does not fail on the bug
  that motivated it is not a gate.

## Security/privacy considerations

`docs/THREAT_MODEL.md` T10. These scripts run against production with credentials, outside the
request path, and `bin/purge.mjs` is the only command in the repository that destroys user work.
An arity error there is not a style problem.

## Acceptance criteria

- [ ] `pnpm --filter @youandfriends/db typecheck` covers `bin/**` and passes.
- [ ] Reintroducing `r2ConfigFrom(env)` with one argument fails the typecheck, demonstrated.
- [ ] `release-check` runs the extended typecheck.
- [ ] No script's behaviour changes.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db typecheck
pnpm release-check
```

## Manual QA

1. `pnpm --filter @youandfriends/db ops:uploads:sweep --dry-run` still runs.
2. `pnpm --filter @youandfriends/db purge --dry-run` still runs.

## Rollback/compatibility

Configuration and annotations only. Reverting restores the hole.

## Status

`pending`

## Commit

_(not yet)_
