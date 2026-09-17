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

**Split out:** audit events for sign-in, sign-out, and failed access move to task `031`.
`audit_events.workspace_id` is `NOT NULL` — every audit row belongs to a tenant, by design — and
at this point in the plan a signed-in person has no workspace: task `031` is what creates one on
first sign-in. There is nothing to attribute the event to.

The alternatives were both worse. Making the column nullable would weaken a tenancy invariant
across the whole audit log to accommodate one event class. Writing the event against a
fabricated or "pending" workspace id would put a lie in the one table that exists to be trusted
afterwards. So the emitter is written where a workspace id exists, one task later, and the
actions stay declared here (`auth.signed_in`, `auth.signed_out`, `access.denied` already carry
`emittedBy: '030'` in `packages/contracts/src/audit.ts` — that string is now wrong and `031`
corrects it).

Recorded rather than quietly dropped, per CLAUDE.md §3.

## Non-scope

- Public sign-up (deferred `209`) — iteration one is invitation-only.
- Organizations or multi-tenancy beyond one workspace per owner.
- Invitation acceptance (task `032`).

## Dependencies

`022`, `012`

## Files expected to change

```
apps/web/proxy.ts                     (middleware.ts is deprecated in Next 16)
apps/web/app/(auth)/**
apps/web/app/layout.tsx               (ClerkProvider)
apps/web/lib/auth/**
apps/web/lib/auth/__tests__/**
apps/web/vitest.config.ts
apps/web/package.json
packages/contracts/src/ids.ts         (newUlid — see below)
packages/authz/src/audit.ts           (uses it instead of its own copy)
```

`packages/authz/src/subjects.ts` needed no change: `memberSubject` was already the right shape.

**`newUlid` in `contracts`.** Provisioning a `users` row needs a ULID, and there was no shared
generator — `packages/authz` had one private to its audit module and the seed has a
deterministic variant. A third copy would have been three chances to get the alphabet or the
width wrong in a value every other table uses as a foreign key, so the generator moved to
`contracts`, beside `isUlid`, and `authz` now calls it. Net one fewer implementation.

## Implementation notes

- The Clerk user id maps to our `users` row; **our** id is the foreign key everywhere else. Never scatter Clerk ids through the schema — a provider change should not be a schema migration.
- Just-in-time user creation must be idempotent under concurrent requests. Two simultaneous first requests must not create two rows; use an upsert on the Clerk id unique constraint.
- Session resolution runs once per request and feeds `authz`. Do not call Clerk repeatedly within a request.
- Sign-in surfaces are the one place the tagline appears — never as interface chrome inside the workspace (`docs/DESIGN.md` §16).
- Middleware must fail closed: an error resolving the session denies access rather than falling through.

## Security/privacy considerations

The authentication boundary. Middleware must fail closed. Clerk keys are server secrets covered by the task `002` redaction list. Failed access attempts are audited (T-series baseline). Session fixation and CSRF are handled by Clerk's session model — do not hand-roll around it.

## Acceptance criteria

- [x] Unauthenticated users are redirected from protected routes.
      A deny-list of what is public, so a route is protected by being new. Its own test caught
      that `'/sign-in(.*)'` also matched `/sign-in-anything`, which would have made any later
      route with that prefix public by accident.
- [x] Sign-in and sign-up render in Studio Notebook styling with the tagline.
      Every colour handed to Clerk comes from `@youandfriends/ui/tokens`, asserted rather than
      retyped; the tagline is asserted present here and absent from the workspace shell.
- [x] A `users` row is created just-in-time, idempotently under concurrency.
      Ten simultaneous first sign-ins against a real Postgres produce one row, one id, and
      exactly one caller reporting it created it. The conflict target is `clerk_user_id`, which
      is the only unique key on the table — `users.email` carries a plain index, so two Clerk
      accounts sharing an address cannot repoint one person's row at another's identity.
- [x] Server-side session resolution produces a subject consumable by `authz`.
- [x] Middleware fails closed on session resolution error.
      Every failure path denies: Clerk throwing, an identity with no email, the database
      refusing. Each is a test, and none of them reaches for a default.
- [ ] Sign-in, sign-out, and failed access are audited.
      **Moved to task `031`** — see the split under Scope. `audit_events.workspace_id` is
      `NOT NULL` and there is no workspace at this point in the plan.

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

**Step 3 is done**, and harder than asked: ten concurrent first sign-ins against a real Postgres
produce one row, one id, and exactly one caller reporting `created: true` — see
`lib/auth/__tests__/provision.test.ts`. Two would have passed by luck.

**Steps 1 and 2 need Clerk keys**, which are the user's to create:
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, in `.env.local` and in the Vercel
project settings. The user has taken that on. Until they exist, nothing here can sign in — the
build, the types, and every code path are verified, but a live session is not, and this task does
not claim otherwise (CLAUDE.md §6).

What that leaves unverified in practice: that Clerk's redirect actually lands on `/sign-in`, and
that the appearance values render as intended. Both are verified in code and neither has been
seen.

## Rollback/compatibility

Reverting removes authentication entirely and exposes the workspace. Never revert on a deployed instance.

## Status

`in-progress`

## Blocker

Clerk keys — the user is creating the application; manual QA steps 1 and 2 cannot run until `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` exist.

## Commit

`3255871`
