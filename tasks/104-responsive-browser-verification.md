# 104 — Responsive verification in a real browser

**Phase:** Mobile and PWA · **Iteration:** one

## Objective

Walk every flow in `docs/RESPONSIVE_CHECKLIST.md` in a real browser at the four widths, in
landscape and with the keyboard raised, and fix what breaks.

## Why this exists

Split out of task `101` on 2026-10-13. `101` did the source audit, the fixes it found, and the
checklist. The browser half could not run in the agent environment, because the app serves
nothing without Clerk configured (`proxy.ts`, by design). Kept as its own numbered task so the
unverified part stays visible.

## Scope

- Every row of the flow inventory, at iPhone SE, iPhone Pro, tablet, and desktop widths.
- Landscape for the player and lyrics; the keyboard raised on every form.
- Measured 44 × 44 px targets and no horizontal scroll, recorded in the checklist's audit log.
- Fixes for whatever the walk finds.

## Non-scope

- New features; Playwright automation (task `120`).

## Dependencies

`101`

## Files expected to change

```
docs/RESPONSIVE_CHECKLIST.md
apps/web/components/**
```

## Implementation notes

- Needs a signed-in session. In an agent session that means Clerk development keys
  (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) and a seeded database. On a real
  iPhone, it is also the place to confirm safe areas and keyboard behavior.

## Security/privacy considerations

As `101`: hiding a control at a width is never a substitute for authorization.

## Acceptance criteria

- [ ] Every inventory row is checked in a browser at four widths.
- [ ] Landscape and keyboard-raised checks are done.
- [ ] Breaks found are fixed, and the audit log records the pass.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Walk the checklist on a real iPhone, portrait and landscape.

## Rollback/compatibility

Fixes only.

## Status

`blocked`

## Blocker

Needs Clerk development keys in the environment: the app serves nothing without them, by design.

## Commit

_(not yet)_
