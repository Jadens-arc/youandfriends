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

- [x] Comment threads, version lists, file details, and overflow actions use bottom sheets on mobile.
- [x] Multi-height sheets snap to defined positions.
- [x] Focus is trapped on open and restored on close.
- [x] Drag-to-dismiss works and has a keyboard-accessible alternative.
- [x] Sheet scrolling does not scroll the page behind it.
- [x] Safe areas are respected.
- [x] Reduced motion disables the spring.

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

## Implementation record

- `BottomSheetContent` (ui) takes `snapPoints`: `peek` 40dvh, `half` 62dvh, and `full`, which
  clears the notch. Dragging up grows the sheet, down shrinks it and then dismisses. A visible
  "Show more"/"Show less" button does the same from a keyboard. `BottomSheetBody` is the
  scrolling part, with `overscroll-behavior: contain`. The close control is 44 px on a phone.
- `useIsPhone` / `useMediaQuery` (ui): `useSyncExternalStore` over `matchMedia`. It answers
  "desk" on the server and in jsdom.
- `ActionMenu` (`components/shell/mobile/sheets`): one list of actions, shown as a dropdown on a
  desk and a bottom sheet of 48 px rows on a phone. The chosen action runs after the sheet has
  closed and returned focus. Used by the song header, each Project Files entry, and the mobile
  folder drill-down.
- Versions: on a phone the stack is a row ("Version 4 · 6 versions · Change") that opens a
  half/full sheet holding the same radio group. A tap chooses and closes; arrow keys move
  without closing.
- Comment threads: on a phone, a marker under the waveform plays its moment _and_ opens the
  thread in a half/full sheet (`components/comments/mobile/thread-sheet.tsx`). It is the same
  `Thread` component, with the same server-checked actions.
- Focus is trapped and restored by Radix's dialog. Reduced motion already replaced the spring
  with a snap. Safe areas come from the bottom sheet variant.

**Deviation:** file details have no sheet of their own. A Project Files entry's details are
inline in its row, and its actions are the overflow menu, which is now a sheet on a phone.

**Verification:** jsdom tests cover snapping by drag and by button, the action menu at both
widths with focus return, the phone version picker, and the phone thread sheet. Nothing was
looked at on a real phone (see task `104`).

## Review flag

Fast-tracked at the user's request (2026-10-13); no test-reviewer pass. Gesture feel and scroll containment have only been exercised in jsdom.

## Status

`complete`

## Commit

`10f1314`
