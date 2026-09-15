# 020 — Database package, Neon connection, migration tooling

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Stand up `packages/db`: the Drizzle client, Neon connection handling for both pooled and direct access, the migration toolchain, and a transaction helper.

## User value

The durable record of every song, lyric, and comment. Everything else in the product sits on this.

## Scope

- Drizzle ORM configured against Neon Postgres.
- Two connection modes: pooled (HTTP/serverless driver) for route handlers, direct (TCP) for migrations and jobs that need transactions.
- `pnpm --filter @youandfriends/db generate | migrate | migrate:dry | studio` scripts.
- A `withTransaction` helper that is the only sanctioned way to run multi-statement writes.
- Test harness that spins an isolated database per test file (Neon branch or local Postgres via Docker) and tears it down.
- Migration dry-run script targeting an isolated branch, wired into `release-check`.

## Non-scope

- Any table definition (task `021`).
- Authorization logic (task `022`).
- Row-level security — considered and deferred in ADR 0006.

## Dependencies

`002`, `003`

## Files expected to change

```
packages/db/src/{client,schema/index,migrate,transaction}.ts
packages/db/drizzle.config.ts
packages/db/src/__tests__/harness.ts
scripts/release-check.mjs
```

## Implementation notes

- Neon's serverless HTTP driver does not support interactive transactions. Route handlers that need a transaction must use the direct driver — make this a typed distinction so the wrong one cannot be used silently.
- Migrations run against the direct connection, never the pooled one.
- The test harness must give each test file real isolation. Shared state across test files produces tests that pass alone and fail together, which is worse than no test.
- `migrate:dry` against a Neon branch is cheap insurance and is required by `docs/OPERATIONS.md` §4 before every production migration.

## Security/privacy considerations

`DATABASE_URL` is a high-value credential: it is in the task `002` redaction deny-list and must never appear in a log or an error surfaced to a client. Connection errors are logged with a correlation ID and returned as a generic internal error.

## Acceptance criteria

- [ ] Drizzle connects to Neon in both pooled and direct modes, with the distinction enforced by types.
- [ ] `generate`, `migrate`, `migrate:dry`, and `studio` scripts work.
- [ ] `withTransaction` commits on success and rolls back on throw, proven by a test.
- [ ] Each test file gets an isolated database that is torn down afterwards.
- [ ] `migrate:dry` runs in `release-check` and fails on a bad migration.
- [ ] `DATABASE_URL` never appears in logs or client-visible errors.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/db migrate:dry
pnpm release-check
```

## Manual QA

1. Run `migrate` against a scratch Neon branch and confirm tables appear in `studio`.
2. Force an error mid-transaction and confirm rollback.

## Rollback/compatibility

Foundational. Reverting breaks every data-dependent task. No production data exists at this point, so rollback is safe now and will not be later.

## Status

`pending`

## Commit

_(not yet)_
