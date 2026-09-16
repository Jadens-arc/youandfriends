# 004 — Tighten the secret-detection lint exemption

**Phase:** Foundation · **Iteration:** one

## Objective

Narrow the `no-secrets` ESLint exemption so credential-shaped literals in test files are
caught locally, instead of by GitHub push protection at the moment of push.

## User value

Indirect but concrete. A credential that reaches a commit is compromised even if the push is
later rejected — the value is already in local history and in any clone. Catching it at lint
time, before the commit exists, is the difference between an edit and a rotation.

## Scope

- Narrow the exemption in `packages/config/src/eslint/index.mjs` so `no-secrets` stays
  **enabled** for `**/*.test.ts(x)` and `**/__tests__/**`.
- Keep the exemption only for `**/fixtures/**`, where generated high-entropy data legitimately
  lives.
- Establish the convention that credential-shaped test values are assembled at runtime rather
  than written as literals, and document it where test authors will see it.
- Fix any existing violations the tightened rule surfaces.

## Non-scope

- Adding a git pre-commit hook (task `123` decides CI and hook policy).
- Repository-wide secret scanning of history (task `122`).
- Changing the entropy tolerance, unless a violation proves it is miscalibrated.

## Dependencies

`001`, `003`

## Files expected to change

```
packages/config/src/eslint/index.mjs
packages/config/src/*.test.ts
packages/contracts/src/*.test.ts
CLAUDE.md (the convention, if it belongs there)
```

## Implementation notes

- This task exists because the exemption failed in practice. During task `002`, a realistic
  Stripe-shaped key in a test fixture passed lint and was caught only by GitHub push
  protection rejecting the push. The control worked; ours did not.
- Enabling `no-secrets` for tests will produce false positives on legitimate high-entropy
  test data. The fix is the runtime-assembly convention, not a broader exemption — if a test
  needs a credential-shaped value, building it from parts keeps both the scanner and the
  lint rule quiet without weakening either.
- Check the tolerance against real test data before changing it. A tolerance loose enough to
  never fire is the same as no rule.

## Security/privacy considerations

Directly hardens THREAT_MODEL T9. The current state has a known hole with a demonstrated
instance, which is the strongest possible argument for closing it.

## Acceptance criteria

- [x] `no-secrets` is enabled for test files and `__tests__` directories.
- [x] The exemption covers only `**/fixtures/**`.
- [x] A credential-shaped literal in a test file fails lint, proven with a deliberate probe.
- [x] Existing tests pass under the tightened rule.
- [x] The runtime-assembly convention is documented where a test author will encounter it.

## Tests and validation commands

```bash
pnpm lint
pnpm release-check
# Probe: add a credential-shaped literal to a test file, confirm lint fails, remove it.
```

## Manual QA

1. Add a realistic provider key literal to a test file; confirm `pnpm lint` rejects it.
2. Confirm the existing suite still passes with no false positives.

## Rollback/compatibility

Lint configuration only. Reverting restores the looser exemption and the known hole.

## Status

`complete`

## Commit

_(not yet)_
