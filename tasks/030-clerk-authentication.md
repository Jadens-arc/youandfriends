# 030 — Clerk authentication and session handling

**Phase:** Authentication and workspace · **Iteration:** one

## Objective

Integrate Clerk for sign-in, route protection, and server-side session resolution, mapping the Clerk identity to our `users` record.

## User value

Signing in to a private workspace — the front door, and the guarantee that the door is locked.

## Scope

- Clerk provider, middleware, and protected route groups.
- Sign-in and sign-up surfaces styled into Studio Notebook, carrying the tagline _Where songs live between sessions._
- Server-side session resolution producing an authenticated subject for `packages/authz`.
- Just-in-time creation of the `users` row on first sign-in, mapped to the Clerk user id.
- Sign-out and session expiry handling.
- Audit events for sign-in, sign-out, and failed access.

## Non-scope

- Public sign-up (deferred `209`) — iteration one is invitation-only.
- Organizations or multi-tenancy beyond one workspace per owner.
- Invitation acceptance (task `032`).

## Dependencies

`022`, `012`

## Files expected to change

```
apps/web/middleware.ts
apps/web/app/(auth)/**
apps/web/lib/auth/**
packages/authz/src/subjects.ts
apps/web/lib/auth/__tests__/**
```

## Implementation notes

- The Clerk user id maps to our `users` row; **our** id is the foreign key everywhere else. Never scatter Clerk ids through the schema — a provider change should not be a schema migration.
- Just-in-time user creation must be idempotent under concurrent requests. Two simultaneous first requests must not create two rows; use an upsert on the Clerk id unique constraint.
- Session resolution runs once per request and feeds `authz`. Do not call Clerk repeatedly within a request.
- Sign-in surfaces are the one place the tagline appears — never as interface chrome inside the workspace (`docs/DESIGN.md` §16).
- Middleware must fail closed: an error resolving the session denies access rather than falling through.

## Security/privacy considerations

The authentication boundary. Middleware must fail closed. Clerk keys are server secrets covered by the task `002` redaction list. Failed access attempts are audited (T-series baseline). Session fixation and CSRF are handled by Clerk's session model — do not hand-roll around it.

## Acceptance criteria

- [ ] Unauthenticated users are redirected from protected routes.
- [ ] Sign-in and sign-up render in Studio Notebook styling with the tagline.
- [ ] A `users` row is created just-in-time, idempotently under concurrency.
- [ ] Server-side session resolution produces a subject consumable by `authz`.
- [ ] Middleware fails closed on session resolution error.
- [ ] Sign-in, sign-out, and failed access are audited.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm build
```

## Manual QA

1. Sign in, confirm the workspace loads; sign out, confirm protection returns.
2. Hit a protected route directly while signed out; confirm redirect.
3. Fire two concurrent first-time requests; confirm exactly one user row.

## Rollback/compatibility

Reverting removes authentication entirely and exposes the workspace. Never revert on a deployed instance.

## Status

`pending`

## Commit

_(not yet)_
