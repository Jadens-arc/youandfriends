# 023 — Executable permission matrix and IDOR test suite

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Turn the permission rules into an exhaustive, executable matrix, and add a cross-workspace IDOR test for every sensitive resource class. This must land before any collaboration route is exposed.

## User value

Collaborators get exactly the access they were given — provably, not hopefully. This is the test suite that lets the owner invite someone without anxiety.

## Scope

- Enumerated matrix over role × capability × scope depth × deny-override × subject type.
- A cross-workspace IDOR test for every sensitive resource class: folders, projects, songs, assets, versions, lyrics, comments, voice notes, notifications, audit events, upload sessions, share links, sync tokens.
- Assertions that unauthorized access returns a **404-shaped** response, never a 403 that confirms existence.
- Negative tests for the sync-token subject: cannot read outside its allow-list, cannot write outside Project Files, cannot touch another workspace.
- A test helper that makes adding the IDOR case for a new resource class a one-liner, so future tasks cannot skip it cheaply.
- A written permission matrix in `docs/` generated from the same table the tests use, so prose cannot drift from behavior.

## Non-scope

- Rate limiting and enumeration resistance on share links (deferred `202`).
- Penetration testing.
- Row-level security (deferred `217`).

## Dependencies

`022`

## Files expected to change

```
packages/authz/src/__tests__/{matrix,idor}.test.ts
packages/authz/src/__tests__/helpers.ts
docs/PERMISSION_MATRIX.md
scripts/generate-permission-matrix.mjs
```

## Implementation notes

- The matrix must be **generated from a table**, not hand-written per case, or it will be incomplete and nobody will notice which cell is missing.
- Every IDOR test asserts the 404 shape explicitly. A test that only asserts 'not 200' will pass against a 403 that leaks existence.
- The helper should take a resource class and produce the full negative-case set, so task `026` and later tasks add coverage by registering their resource rather than writing tests from scratch.
- Generating `docs/PERMISSION_MATRIX.md` from the test table is what keeps documentation honest — regenerate it in `release-check` and fail if it is stale.

## Security/privacy considerations

This task is the primary verification of THREAT_MODEL T1 and T2. It is a gate: **no collaboration route ships before it passes.** The 404-shape assertion is a specific control against existence disclosure.

## Acceptance criteria

- [ ] The matrix covers every combination of role, capability, scope depth, deny override, and subject type.
- [ ] Every sensitive resource class has a cross-workspace IDOR test.
- [ ] Unauthorized access is asserted to be 404-shaped for every class.
- [ ] Sync-token negative cases pass.
- [ ] `docs/PERMISSION_MATRIX.md` is generated and `release-check` fails if it is stale.
- [ ] Adding a resource class without its IDOR test fails the suite.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm run generate:permission-matrix -- --check
pnpm release-check
```

## Manual QA

1. Read `docs/PERMISSION_MATRIX.md` and confirm it matches the intent in `docs/DESIGN.md` §3.
2. Deliberately weaken a resolution rule and confirm the matrix fails.

## Rollback/compatibility

Test-only; no runtime change. Reverting removes the guard that makes every later authorization change safe — do not revert.

## Status

`pending`

## Commit

_(not yet)_
