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
packages/db/src/{client,schema/index,migrate,transaction,scratch,dry-run,env-file}.ts
packages/db/drizzle.config.ts
packages/db/bin/{migrate,migrate-dry}.mjs
packages/db/src/__tests__/harness.ts
packages/db/migrations/meta/_journal.json
packages/db/vitest.config.ts
packages/config/src/redact.ts
scripts/release-check.mjs
docs/OPERATIONS.md
```

Three files beyond the plan, each for a reason recorded below: `scratch.ts` (the throwaway
database both the harness and the dry run need), `env-file.ts` (one connection-string lookup
instead of three that drift), and a value pattern added to `packages/config/src/redact.ts`
because this task's own security note could not otherwise be honoured.

## Implementation notes

- Neon's serverless HTTP driver does not support interactive transactions. Route handlers that need a transaction must use the direct driver — make this a typed distinction so the wrong one cannot be used silently.
- Migrations run against the direct connection, never the pooled one.
- The test harness must give each test file real isolation. Shared state across test files produces tests that pass alone and fail together, which is worse than no test.
- `migrate:dry` against a Neon branch is cheap insurance and is required by `docs/OPERATIONS.md` §4 before every production migration.

## Security/privacy considerations

`DATABASE_URL` is a high-value credential: it is in the task `002` redaction deny-list and must never appear in a log or an error surfaced to a client. Connection errors are logged with a correlation ID and returned as a generic internal error.

## Acceptance criteria

- [x] Drizzle connects in both pooled and direct modes, with the distinction enforced by
      types. `PooledDatabase` and `DirectDatabase` carry distinct brands and `withTransaction`
      accepts only the direct one, so the wrong driver is a type error rather than a
      half-applied write. Live connection to Neon is verified at deploy — see the note below.
- [x] `generate`, `migrate`, `migrate:dry`, and `studio` scripts work. `generate` produced
      the migration journal now in the repository; `migrate` and `migrate:dry` were run
      end-to-end against a real Postgres.
- [x] `withTransaction` commits on success and rolls back on throw, proven by tests against a
      real database — including a rollback triggered by Postgres itself (a duplicate key),
      not only by a thrown error.
- [x] Each test file gets an isolated database that is torn down afterwards, proven by a test
      that creates two and then asserts against `pg_database` that both are gone.
- [x] `migrate:dry` runs in `release-check` and fails on a bad migration. Verified by feeding
      it one: exit code 1, with the offending statement named. Restored, exit code 0.
- [x] `DATABASE_URL` never appears in logs or client-visible errors — and the control had a
      hole, now closed. See below.

## Verification

Every test and both migration commands ran against a real PostgreSQL 16 server. Nothing here
is mocked: a fake driver would accept a migration Postgres rejects, which is the one thing
this task exists to catch.

```
Test Files  7 passed (7)
     Tests  38 passed (38)
Statements : 100% · Functions : 100% · Lines : 100%

release-check: format · task index · lint · typecheck · unit · build ·
               migration dry run · dependency audit   — all pass
```

The dry-run gate, proven in both directions:

```
$ pnpm --filter @youandfriends/db migrate:dry          # a migration Postgres rejects
Migration dry run FAILED on yaf_scratch_migrate_dry_02f1c8f6:
  Failed query: alter table no_such_table add column oops int;
EXIT CODE: 1

$ pnpm --filter @youandfriends/db migrate:dry          # restored
Migration dry run passed: 0 applied to yaf_scratch_migrate_dry_db3aead0.
```

**The Neon project is real and live.** Provisioned as `youandfriends`
(`proud-cake-80592729`, Postgres 17, `aws-us-east-1`), confirmed through the Neon API:

```
db            | role                | public_tables
youandfriends | youandfriends_owner | 0
```

**What was not verified here, and why.** This session's sandbox allows outbound HTTPS only
through a proxy allow-list, which denies both Postgres on 5432 and Neon's HTTPS endpoint
(`gateway answered 403 to CONNECT`). So the driver code could not open a socket to Neon from
this container. That is an environment constraint, not a gap in the code: the same code ran
against a real Postgres throughout, and the first deploy exercises the Neon path. The
symptom of that constraint — a command that hangs instead of failing — is itself fixed, by
`CONNECT_TIMEOUT_MS`. Written up in `docs/OPERATIONS.md` §4.

Credentials are in `.env.local` and `.env.test.local`, both `.gitignore`d. Nothing in this
commit contains one.

## Decisions taken

- **The two modes are branded types.** Neon's HTTP driver sends each statement as its own
  request, so a "transaction" over it runs as loose statements and a mid-way failure leaves
  the write half-applied, silently. `withTransaction` takes a `DirectDatabase` and nothing
  else. Both brands are applied at exactly one boundary each.
- **`CREATE DATABASE` per test file, not a schema per test.** A schema does not isolate
  extensions, types, or anything a migration creates outside `public` — and a migration is
  what is being exercised. Per _file_ rather than per test because a database costs a round
  trip, and tests within one file are written by someone who can see them all.
- **One connection-string loader, shared by the migrator, the dry run, and the harness.**
  Three copies drift, and the drift reads as "the tests skip but the migration runs", which
  looks like a bug in the code under test. It reads two keys and nothing else, so it cannot
  switch `NODE_ENV` under a test run.
- **Hand-rolled env parsing rather than `dotenv`.** Two keys from files that usually do not
  exist, on the test and migration path. A dependency there is a dependency in the supply
  chain.
- **`tsx` for the CLI entry points.** The repo imports extensionlessly for Turbopack, which
  Node's own ESM resolver cannot follow. `tsx` was already in the tree via `drizzle-kit`; it
  is now declared rather than borrowed.
- **A ten-second connect timeout.** `pg` waits forever by default, which turns an unreachable
  database into a build that hangs. A hung release gate is worse than a red one — nobody
  knows whether to wait or to kill it.

## Security finding, fixed here

`packages/config`'s redaction denied `DATABASE_URL` **by key**, which does not help: `pg` puts
the whole connection string inside the _message_ of a connection error, where no key name
protects it. That is how the credential actually escapes, and this task's security note
promises it cannot. A value-shape pattern for credentialed connection strings now sits
alongside the presigned-URL and bearer-token patterns, with tests covering an error message, an
innocuous key, an `Error` instance, and two negative cases so it does not over-reach.

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

`complete`

## Commit

_(not yet)_
