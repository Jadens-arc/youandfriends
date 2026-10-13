# 033 — Sign in on the app's own pages

**Phase:** Authentication and workspace · **Iteration:** one

## Objective

Fix the production sign-in redirect loop by sending people to the app's own `/sign-in` and
`/sign-up` pages instead of Clerk's hosted Account Portal, and land a fresh sign-in in the
library.

## Why this exists

Reported on 2026-10-13: `https://accounts.youandfriends.org/sign-in?redirect_url=https://youandfriends.org/`
looped. Nothing configured a sign-in URL, so `auth.protect()` fell back to the Account Portal on
`accounts.youandfriends.org`. After signing in there, the app's domain never received Clerk's
session cookies — production responses carried `x-clerk-auth-reason: session-token-and-uat-missing`
— so the proxy sent the visitor back to the portal, which saw them signed in and sent them home.
The app's own sign-in pages (task `030`) existed but were never wired in.

## Scope

- `clerkMiddleware` and `ClerkProvider` name `/sign-in` and `/sign-up`; `<SignIn>` and `<SignUp>`
  use path routing on them.
- A fresh sign-in lands on `/library`; `/` redirects there instead of showing the scaffold
  placeholder.

## Non-scope

- Clerk dashboard settings, DNS, and the Account Portal itself.

## Dependencies

`030`

## Files expected to change

```
apps/web/proxy.ts
apps/web/app/layout.tsx
apps/web/app/page.tsx
apps/web/app/(auth)/**
apps/web/lib/auth/routes.ts
```

## Implementation notes

- Signing in on `youandfriends.org` sets the session cookies first-party, on the domain the proxy
  reads them from, so the loop cannot form.
- Not verified against production from the agent environment (no outbound access to the site);
  the diagnosis is from production response headers fetched through Vercel's tooling.

## Security/privacy considerations

`/sign-in` and `/sign-up` were already public routes; nothing new is exposed. Sign-up remains
restricted by Clerk's own settings (invitation-only).

## Acceptance criteria

- [x] The proxy and the client both point at the app's own sign-in and sign-up pages.
- [x] A fresh sign-in lands in the library; `/` no longer shows the scaffold page.
- [x] Tests hold the wiring and the redirect.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm release-check
```

## Manual QA

1. Sign out, open `https://youandfriends.org/`, and confirm it goes to `youandfriends.org/sign-in`,
   not `accounts.youandfriends.org`.
2. Sign in and confirm it lands on `/library` without looping.

## Rollback/compatibility

Reverting restores the portal redirect and the loop.

## Review flag

Fixed at the user's request (2026-10-13) without a security-reviewer pass; confirm the manual QA in production.

## Status

`complete`

## Commit

_(not yet)_
