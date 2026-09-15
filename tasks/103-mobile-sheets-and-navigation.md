# 103 — Bottom sheets and mobile navigation refinement

**Phase:** Mobile and PWA · **Iteration:** one

## Objective

Refine the mobile secondary surfaces: comment threads, version lists, file details, and action menus as bottom sheets with correct focus and gesture behavior.

## User value

Reaching detail without losing your place, with sheets that behave the way the platform has taught people to expect.

## Scope

- Comment threads, version lists, file details, and overflow actions presented as bottom sheets.
- Multi-height sheets (peek, half, full) where content warrants.
- Correct focus management: trap on open, restore on close.
- Drag-to-dismiss with a keyboard-accessible alternative.
- Scroll containment so sheet content scrolls without scrolling the page behind it.
- Safe-area handling and a gentle spring honoring reduced motion.

## Non-scope

- New functionality — this task changes presentation of existing features.
- Desktop sheet usage.
- Custom gesture physics beyond the design's gentle spring.

## Dependencies

`101`, `014`

## Files expected to change

```
apps/web/components/shell/mobile/sheets/**
packages/ui/src/components/bottom-sheet.tsx
apps/web/components/comments/mobile/**
```

## Implementation notes

- Scroll containment (`overscroll-behavior: contain`) is essential. Without it, scrolling to the end of sheet content scrolls the page behind, which feels broken immediately.
- Focus trap on open and restore on close is an accessibility requirement, not a nicety — a keyboard user who cannot escape a sheet is stranded.
- Drag-to-dismiss needs a keyboard and screen-reader alternative: a visible close control that is always reachable.
- Multi-height sheets should snap, not float between positions. Free positioning feels imprecise on touch.
- Sheets must respect safe-area insets at the bottom or content hides behind the home indicator.

## Security/privacy considerations

Sheets display content subject to the same authorization as their full-screen equivalents. Presentation changes must not introduce a path that renders data before an authorization check resolves.

## Acceptance criteria

- [ ] Comment threads, version lists, file details, and overflow actions use bottom sheets on mobile.
- [ ] Multi-height sheets snap to defined positions.
- [ ] Focus is trapped on open and restored on close.
- [ ] Drag-to-dismiss works and has a keyboard-accessible alternative.
- [ ] Sheet scrolling does not scroll the page behind it.
- [ ] Safe areas are respected.
- [ ] Reduced motion disables the spring.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Open each sheet type on a real iPhone; scroll to the end and confirm the page behind stays put.
2. Open and dismiss a sheet with the keyboard only; confirm focus restoration.
3. Confirm sheet content clears the home indicator.

## Rollback/compatibility

Presentation only. Reverting falls back to full-screen views — functional but less pleasant.

## Status

`pending`

## Commit

_(not yet)_
