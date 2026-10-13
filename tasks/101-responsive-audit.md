# 101 — Responsive audit across all implemented flows

**Phase:** Mobile and PWA · **Iteration:** one

## Objective

Systematically verify every implemented flow at iPhone, tablet, and desktop widths, and fix what breaks. Requirement 10 of the iteration-one definition of done.

## User value

The phone experience is genuinely usable for every flow, not just the ones that happened to get attention.

## Scope

- A flow inventory covering every implemented surface: auth, library, folders, song workspace, upload, player, lyrics, comments, notifications, settings.
- Verification at iPhone SE, iPhone Pro, tablet, and desktop widths.
- Fixes for layout breaks, overflow, unreachable controls, and undersized targets.
- Confirmation of 44×44 px targets on every interactive element on mobile.
- Safe-area handling verified on notched devices.
- A recorded checklist so later tasks can re-run the audit.

## Non-scope

- New features — this task fixes existing ones.
- Desktop-only refinements.
- Native app behaviors.

## Dependencies

`077`, `085`, `095`, `055`

## Files expected to change

```
apps/web/components/**
apps/web/app/**
docs/RESPONSIVE_CHECKLIST.md
```

## Implementation notes

- Work from a written inventory, not from memory. An unaudited flow is an unaudited flow, and the ones that get missed are the ones nobody thought about.
- Test at iPhone SE width (375 px). It is the width that breaks things, and a layout that works there works nearly everywhere.
- Check landscape as well as portrait — the expanded player and lyrics editor are the usual casualties.
- Verify with a real on-screen keyboard raised, not just a narrow viewport. Many mobile layout bugs only appear when the keyboard is up.
- Record the checklist in the repository so task `120`'s Playwright viewport tests and future audits have a shared reference.

## Security/privacy considerations

Responsive fixes must not weaken authorization. A control hidden at narrow width is still a reachable endpoint — hiding is presentation, never a security control.

## Acceptance criteria

- [x] Every implemented flow is inventoried and audited in source. Browser verification at four widths moved to task `104`.
- [x] Layout breaks, overflow, and unreachable controls found in the source audit are fixed.
- [x] All mobile interactive elements meet 44×44 px (by class; measured in `104`).
- [x] Safe areas are handled on notched devices, including landscape side insets.
- [x] Landscape orientation is handled for player and lyrics in source (scrolls, not clips); confirmed in a browser in `104`.
- [x] Keyboard: iOS focus-zoom fixed; the lyrics surface is keyboard-aware from task `085`. Keyboard-raised walk in `104`.
- [x] `docs/RESPONSIVE_CHECKLIST.md` records the audit for reuse.
- [x] No control is hidden as a substitute for authorization.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Walk every flow on a real iPhone, portrait and landscape.
2. Raise the keyboard on every form surface and confirm usability.
3. Verify against `docs/RESPONSIVE_CHECKLIST.md` end to end.

## Rollback/compatibility

Fixes only. Reverting reintroduces layout problems.

## Implementation record

**Split on 2026-10-13.** This task is the source audit and its fixes. Walking the flows in a
real browser is task `104`: the agent environment has no Clerk keys, and the app serves
nothing without them, by design. The acceptance criteria above say which half each one is.

- Primitives (`packages/ui`): `Button` sm/md, `Input`, `SelectTrigger`, dropdown and context
  menu items, and tabs reach 44 px below `md`. The icon button is 44 px square. A test holds it.
- About 30 raw controls fixed to 44 px on mobile: selects in Project Files, members, invites,
  upload, and lyrics; disclosure summaries; tag chips; the upload tray header; the PWA update
  prompt; list links; download links.
- iOS Safari zoomed the page when a 15 px field took focus. Fields are now at least 16 px on
  coarse pointers (`globals.css`, unlayered so it beats utility classes).
- The shell's outer frame takes the left and right safe-area insets for landscape on notched
  phones.
- `docs/RESPONSIVE_CHECKLIST.md`: widths, rules, a flow inventory with code and browser
  columns, and an audit log.

## Review flag

Fast-tracked at the user's request (2026-10-13). Audited in source only; nothing was looked at in a browser — that is task `104`.

## Status

`complete`

## Commit

_(not yet)_
