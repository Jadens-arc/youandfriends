# 002 — Environment configuration and observability hooks

**Phase:** Foundation · **Iteration:** one

## Objective

Parse and validate all environment configuration once, at startup, with Zod; fail loudly on a
missing required variable; and provide structured logging plus Sentry-compatible error hooks
that disable cleanly when no DSN is configured.

## User value

A misconfigured deployment fails immediately with a precise message instead of failing later
in a confusing way during an upload. Errors become diagnosable.

## Scope

- `packages/config/src/env.ts`: a Zod schema for every variable, split into server-only and
  public (`NEXT_PUBLIC_*`) with a type-level guard preventing server secrets leaking into
  client bundles.
- Fail-fast validation at process start with a readable report of every missing/invalid
  variable at once — not one at a time.
- Structured logger (JSON in production, human-readable in development) with request
  correlation IDs.
- Error reporting interface with a Sentry adapter and a no-op adapter selected by DSN presence.
- `.env.example` completed with every variable, its purpose, whether it is required, and where
  to obtain it.

## Non-scope

- Actually provisioning any provider account.
- Log shipping or an observability dashboard.
- Rate limiting (task `202`).

## Dependencies

`000`, `001`

## Files expected to change

```
packages/config/src/{env.ts,logger.ts,observability.ts,index.ts}
packages/config/src/__tests__/env.test.ts
.env.example  apps/web/instrumentation.ts
```

## Implementation notes

- Server/public split must be enforced by types, not convention: a `publicEnv` object that
  structurally cannot contain a secret key.
- The logger must **redact** known-sensitive keys (`*_SECRET`, `*_TOKEN`, `DATABASE_URL`,
  `authorization`, presigned URLs) via a deny-list applied at serialization, so a careless
  `log.info({ session })` cannot leak a credential.
- Presigned URLs must never be logged — they are bearer credentials (see THREAT_MODEL T3).
- The no-op error adapter must be genuinely silent, not a console spew, and must never throw.

## Security/privacy considerations

This task is where credential hygiene is mechanized. The redaction deny-list is a security
control and its tests are security tests. Presigned-URL redaction is explicitly tested.

## Acceptance criteria

- [x] Missing a required variable fails at startup with all problems listed at once.
- [x] Server secrets are structurally unavailable to client code.
- [x] The logger redacts secrets, tokens, `DATABASE_URL`, authorization headers, and presigned URLs.
- [x] With no Sentry DSN, error reporting is a silent no-op and nothing throws.
- [x] With a DSN, errors reach the adapter.
- [x] `.env.example` documents every variable with description and source; no values.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/config test
pnpm release-check
```

Tests must include: missing required var, invalid format, redaction of each sensitive key
shape, presigned URL redaction, and no-op adapter silence.

## Manual QA

1. Unset a required variable; start the app; confirm a clear startup failure.
2. Log an object containing a fake token; confirm redaction in output.

## Rollback/compatibility

Additive. Reverting loses validation but breaks no data. Must land before any task that reads
`process.env` directly.

## Status

`complete`

## Commit

`4446123808d7ff78b165c04cc5c7305b79e501b6`
