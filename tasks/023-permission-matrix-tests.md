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
packages/authz/src/__tests__/{matrix,resources,helpers}.ts
packages/authz/src/resolve.ts
docs/PERMISSION_MATRIX.md
scripts/generate-permission-matrix.mjs
scripts/release-check.mjs
```

`matrix.ts` and `resources.ts` are data, separate from the tests that execute them, because
the document generator reads the same files. A generator with its own copy of the table would
drift from the suite, which is the failure this task exists to prevent.

## Implementation notes

- The matrix must be **generated from a table**, not hand-written per case, or it will be incomplete and nobody will notice which cell is missing.
- Every IDOR test asserts the 404 shape explicitly. A test that only asserts 'not 200' will pass against a 403 that leaks existence.
- The helper should take a resource class and produce the full negative-case set, so task `026` and later tasks add coverage by registering their resource rather than writing tests from scratch.
- Generating `docs/PERMISSION_MATRIX.md` from the test table is what keeps documentation honest — regenerate it in `release-check` and fail if it is stale.

## Security/privacy considerations

This task is the primary verification of THREAT_MODEL T1 and T2. It is a gate: **no collaboration route ships before it passes.** The 404-shape assertion is a specific control against existence disclosure.

## Acceptance criteria

- [x] The matrix covers every combination of role × scope depth × deny override × subject kind
      (320 cases), all 16 capability pairs against every role, and the membership baseline
      against every subject kind. The _completeness_ of the sweep is itself asserted — a sweep
      that silently stopped covering `owner` or `share_link` would otherwise still pass every
      case it ran.
- [x] Every sensitive resource class has a cross-workspace test. Six exist today and are
      covered; twelve more are registered as `pending` with the task that creates them, and
      the suite fails if one of those tables appears without its entry being converted.
- [x] Unauthorized access is asserted 404-shaped for every class — public code, HTTP status,
      **and message**, compared against a genuine not-found rather than checked in isolation.
- [x] Sync-token negative cases pass: no workspace-scoped handle, no membership baseline from
      the person who issued it, no access beyond its explicit grants, nothing in another
      workspace. One case is deferred and said so below.
- [x] `docs/PERMISSION_MATRIX.md` is generated, and `release-check` fails if it is stale —
      verified by editing the file and watching the gate reject it.
- [x] Adding a resource class without its test fails the suite — verified by removing
      `favorites` from the registry and watching the check name it.

## Verification

```
@youandfriends/authz  450 tests   99.66% statements   100% functions
release-check: 10 gates, all pass
```

Three things were checked by breaking them, because a guard that has never failed is a guard
nobody has tested:

- **Weakening the deny rule** (making a deny stop overriding anything) failed **126 of 450**
  cases. This is the task's own manual-QA step, run.
- **Hand-editing `docs/PERMISSION_MATRIX.md`** failed the new `permission matrix` gate with
  the regeneration command in the message.
- **Removing `favorites` from the resource registry** failed the completeness check, which
  named the unregistered table.

## A rule hardened by the sweep

The sweep enumerates grant level against deny level including the case where both sit at the
_same_ scope. A unique index makes that unreachable through the database — one grant per
subject per scope — but the resolver read whichever candidate it saw first, so the answer
depended on row order. It now prefers the deny on a tie. The state should be impossible; if
that index were ever dropped, the safer answer is the one that falls out rather than the one
that happens to be read second.

## Decisions taken

- **Expectations are stated, never computed.** The sweep's expected answers come from one
  independent line — _a deny wins if and only if it sits at or above the winning grant's
  level_ — which is a different formulation from the resolver's facet walk. A test that
  derives its expectation from the algorithm under test proves only that the algorithm is
  deterministic.
- **Fifteen named cases alongside the sweep.** A table of 320 generated rows documents
  nothing; each named case is a sentence an owner might say, and each carries the reason it
  exists. Those are what `docs/PERMISSION_MATRIX.md` renders.
- **The registry is checked against the live database, not against the schema module.** A
  table created by hand-written SQL in a migration would be invisible to a check that read
  TypeScript, and invisible is exactly how a tenant-owned table skips its test.
- **Pending classes are entries, not omissions.** The check asserts a pending class really has
  no table yet, so when task `026` adds `assets` the suite fails until the entry is converted.
  Deleting the entry is not a way out — the completeness check catches the new table
  immediately.
- **Refusals are compared, not just asserted.** `expectIndistinguishable` checks that "exists
  but is not yours" and "does not exist" serialize identically, which catches a difference
  nobody thought to assert on.
- **`db/authz integration` is its own gate.** It runs inside `unit` too, but this is the suite
  that gates every collaboration route and it belongs in the gate list rather than buried in a
  workspace-wide run.

## Deferred, and why

One scope item cannot be tested yet: **"a sync token cannot write outside Project Files."**
That rule is about asset _kinds_, and `assets` arrives in task `026`. Writing the test now
would mean asserting against a table that does not exist. It is registered as a pending
resource class, so task `026` cannot land without the suite demanding it.

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

`complete`

## Commit

_(not yet)_
