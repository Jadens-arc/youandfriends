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

- [ ] Every implemented flow is inventoried and verified at four widths. (**Inventoried, not verified.** `docs/RESPONSIVE_CHECKLIST.md` lists every route and surface against 375, 393, 820 and 1280, plus landscape and keyboard columns. None can be ticked yet: every route but sign-in, unsubscribe and offline needs a signed-in Clerk session, and none could be made here. See Blocker.)
- [ ] Layout breaks, overflow, and unreachable controls are fixed. (Those found were fixed: a long breadcrumb that overflowed its list, and the docked lyrics toolbar under the home indicator. Finding the rest needs the walk-through above.)
- [x] All mobile interactive elements meet 44×44 px. (Enforced at the base rather than per component:
  - Every `Button` size has a phone floor.
  - Every button, select, summary, text field and button-like role gets a 44 px floor on narrow screens and on any touch pointer (`globals.css`, zero specificity).
  - Standalone links and checkbox labels use `touch-target` / `touch-height`.
  - Targets inside a line of text are exempt under WCAG's inline exception, and opt out explicitly.

  Measured in Chromium on the production CSS build at all four widths; see the table in the checklist. The first measurement caught touch tablets below 44 px, which led to the coarse-pointer rule. A static scan narrowed 138 candidate elements to the ones this covers. The rendered app itself has not been measured.)

- [ ] Safe areas are handled on notched devices. (Checked in code: the header, bottom navigation, expanded player and upload tray pad by the insets, and the docked lyrics toolbar now does too while resting on the edge. Not seen on a notched device.)
- [ ] Landscape orientation works for player and lyrics. (Not verified; needs the rendered app.)
- [ ] Layouts are verified with the on-screen keyboard raised. (Not verified. The lyrics keyboard docking from task `085` is covered by its own tests, but no form was seen with a real keyboard.)
- [x] `docs/RESPONSIVE_CHECKLIST.md` records the audit for reuse. (Widths, the rules each screen is held to, the flow inventory, what was measured, and how to re-run the measurement. Task `120`'s viewport suite is its natural home.)
- [x] No control is hidden as a substitute for authorization. (Nothing in this task hides a control. The checklist makes this a rule for every row: a control absent at a width is still an endpoint, refused by the server.)

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

`blocked`

## Blocker

The real-browser walk-through at four widths, in landscape, and with the keyboard raised needs a signed-in session, and this environment had no Clerk session or credentials. What could be done without one is done: the touch-target floor, measured in Chromium on the built CSS; two layout fixes; and the checklist. To unblock: walk `docs/RESPONSIVE_CHECKLIST.md` in a signed-in browser, or with task `120`'s Playwright setup and a test user, tick each row, and fix what breaks.

## Commit

_(not yet)_
