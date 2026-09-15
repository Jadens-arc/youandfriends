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

- [ ] Every implemented flow is inventoried and verified at four widths.
- [ ] Layout breaks, overflow, and unreachable controls are fixed.
- [ ] All mobile interactive elements meet 44×44 px.
- [ ] Safe areas are handled on notched devices.
- [ ] Landscape orientation works for player and lyrics.
- [ ] Layouts are verified with the on-screen keyboard raised.
- [ ] `docs/RESPONSIVE_CHECKLIST.md` records the audit for reuse.
- [ ] No control is hidden as a substitute for authorization.

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

## Status

`pending`

## Commit

_(not yet)_
