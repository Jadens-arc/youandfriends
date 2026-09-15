# 120 — Playwright critical path tests

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Build end-to-end tests for the critical flows at desktop and iPhone viewports, including deliberately non-brittle visual assertions.

## User value

The flows that matter keep working across changes, verified in a real browser rather than in isolation.

## Scope

- Playwright configured for Chromium and WebKit at desktop and iPhone viewports.
- Critical paths: sign in; navigate library; upload a file; wait for processing; play; switch versions; edit lyrics; post a timestamped comment; check notifications.
- Test authentication that does not require a real Clerk session per test.
- Visual assertions on layout and key components — structural, not pixel-perfect (per the build prompt).
- Fixtures and seeded state for deterministic runs.
- Wired into `release-check` and CI.

## Non-scope

- Testing against production.
- Exhaustive coverage — unit and integration tests carry that load.
- Pixel-perfect screenshot diffing, explicitly avoided as brittle.

## Dependencies

`101`, `027`, `066`

## Files expected to change

```
apps/web/e2e/**
playwright.config.ts
scripts/release-check.mjs
apps/web/e2e/fixtures/**
```

## Implementation notes

- Visual assertions should check structure and layout relationships (element presence, ordering, approximate position, no overflow) rather than exact pixels. Pixel diffs fail on font rendering differences and get disabled, which is worse than not having them.
- Use Playwright's storage state to authenticate once and reuse, rather than signing in per test.
- WebKit coverage matters more than usual here because iOS Safari is a primary target. Do not test Chromium only.
- Media processing takes real time. Either use `InlineDispatcher` for e2e or wait on job status with a generous timeout — never a fixed `sleep`.
- Tests must be deterministic. A flaky e2e suite trains people to re-run rather than investigate, which defeats the purpose.
- Run against seeded data (task `027`) so state is known.

## Security/privacy considerations

E2E tests must not use real credentials or real music. Test accounts and generated fixtures only. Test artifacts (traces, screenshots) must not be committed and must not contain secrets — add them to `.gitignore`.

## Acceptance criteria

- [ ] Playwright runs on Chromium and WebKit at desktop and iPhone viewports.
- [ ] Every listed critical path is covered.
- [ ] Authentication is handled once via storage state.
- [ ] Visual assertions are structural, not pixel-perfect.
- [ ] Media processing waits are event-based, never fixed sleeps.
- [ ] The suite is deterministic across repeated runs.
- [ ] The suite runs in `release-check` and CI.
- [ ] Test artifacts are gitignored and contain no secrets.

## Tests and validation commands

```bash
pnpm exec playwright install --with-deps
pnpm test:e2e
pnpm release-check
```

## Manual QA

1. Run the suite three times and confirm no flakes.
2. Break a critical path deliberately and confirm the suite catches it.
3. Review a WebKit trace for the iPhone viewport.

## Rollback/compatibility

Test-only. Reverting removes end-to-end coverage.

## Status

`pending`

## Commit

_(not yet)_
