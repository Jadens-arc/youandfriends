# 016 — Menu and focus coverage in a real browser

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Verify the keyboard and focus behaviour that jsdom cannot test: menu traversal, focus movement
into and within overlays, and focus restoration on close. These run in a real browser.

## User value

The interactions this covers are how a keyboard or screen-reader user operates the product.
They are currently implemented and unverified by automation, which is the gap this closes.

## Scope

- Playwright coverage for `DropdownMenu` and `ContextMenu`: open by keyboard, traverse with
  arrows, type-ahead, select with Enter, close with Escape, focus returns to the trigger.
- Focus-movement assertions for `Dialog` and `Sheet` that jsdom cannot make: focus moves into
  the layer on open, is trapped while open, and returns to the trigger on close.
- Roving-tabindex behaviour on `Tabs` once focus enters the list.
- Run at desktop and iPhone viewports.

## Non-scope

- Re-testing what the jsdom suite already proves (roles, labels, state attributes, activation).
- Visual regression (task `120` owns the screenshot assertions).
- New components.

## Dependencies

`012`, `120`

## Files expected to change

```
apps/web/e2e/primitives.spec.ts
packages/ui/src/components/*.test.tsx   (cross-references to this task)
```

## Implementation notes

- **This task exists because task `012` hit a hard limit, not because coverage was
  deprioritised.** Measured during `012`: each Radix menu mount in a jsdom worker costs
  progressively more — 3.1s, 6.9s, 12.9s, 13.1s across successive tests in one file, with the
  fifth exceeding a 20s timeout. Two menu tests alone took 54s; the rest of the package's 85
  tests take 3.1s combined. Resetting document state and removing leaked portal containers
  between tests changed nothing, so the accumulation is inside Radix's or jsdom's own
  bookkeeping rather than stray DOM.
- Focus assertions are the other half. Radix moves focus using browser focus management that
  jsdom does not implement, so `toHaveFocus()` after an open is unreliable there regardless of
  cost. A real browser makes these assertions both possible and meaningful.
- Do not reintroduce menu tests into the jsdom suite. If a future Radix or jsdom release fixes
  the cost, revisit deliberately and measure before adding more than two.

## Security/privacy considerations

None directly. Keyboard operability is an accessibility requirement (`docs/DESIGN.md` §12), and
a control reachable only by mouse excludes users rather than exposing data.

## Acceptance criteria

- [ ] Menu open, arrow traversal, selection, and Escape are verified in a real browser.
- [ ] Focus moves into a dialog and a sheet on open and returns to the trigger on close.
- [ ] Tabs roving tabindex is verified once focus enters the list.
- [ ] Assertions run at desktop and iPhone viewports.
- [ ] The jsdom suite remains free of menu tests, with a comment pointing here.

## Tests and validation commands

```bash
pnpm test:e2e -- primitives
pnpm release-check
```

## Manual QA

1. Operate a dropdown menu with the keyboard only; confirm focus is always visible.
2. Open and close a dialog with the keyboard; confirm focus returns to the trigger.

## Rollback/compatibility

Test-only. Reverting removes browser verification of keyboard behaviour.

## Status

`pending`

## Commit

_(not yet)_
