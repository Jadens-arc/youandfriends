# 014 — Mobile application shell

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Collapse the desktop shell into the iPhone experience: full-screen drill-down navigation, bottom navigation bar, mini-player above it, and bottom sheets for secondary detail.

## User value

The iPhone is a working surface, not a viewer. The shell has to make drilling in and getting back feel native.

## Scope

- Bottom navigation bar with the primary destinations and 44×44 px minimum targets.
- Full-screen drill-down: folder → project → song, with a reliable back affordance and correct history behavior.
- Mini-player docked directly above the bottom navigation, expandable to a full-screen player.
- Bottom sheet primitive with a gentle spring, drag-to-dismiss, and correct focus management.
- Safe-area inset handling for notch and home indicator.
- The same reserved-player-region structure as desktop, so audio survives navigation identically.

## Non-scope

- Offline state and downloads (deferred tasks `203`, `204`).
- Expanded player internals (task `077`).
- PWA install and service worker (task `100`).

## Dependencies

`013`

## Files expected to change

```
apps/web/components/shell/mobile/**
packages/ui/src/components/bottom-sheet.tsx
apps/web/app/(workspace)/layout.tsx
apps/web/components/shell/__tests__/**
```

## Implementation notes

- Use CSS `env(safe-area-inset-*)` throughout; a bottom bar that sits under the home indicator feels broken immediately.
- The mini-player must not overlap the last list item — pad the scroll container by the player height, do not rely on a spacer element that can drift.
- Bottom sheets must trap focus and be dismissible by keyboard, not only by drag.
- Drag-to-dismiss must respect `prefers-reduced-motion` by falling back to an instant transition.
- iOS Safari's dynamic viewport units (`dvh`) are needed for full-screen surfaces; `vh` alone misbehaves as the URL bar collapses.

## Security/privacy considerations

Bottom sheets and the expanded player must manage focus correctly for screen-reader and keyboard users. The mobile shell must not expose navigation to inaccessible content.

## Acceptance criteria

- [ ] Bottom navigation renders with 44×44 px minimum targets and respects safe-area insets.
- [ ] Drill-down navigation works with correct browser back behavior.
- [ ] The mini-player sits above the bottom navigation and never overlaps content.
- [ ] Bottom sheets spring open, dismiss by drag and by keyboard, and manage focus correctly.
- [ ] Full-screen surfaces use dynamic viewport units and behave correctly as the Safari URL bar collapses.
- [ ] Reduced motion disables the spring.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Test on a real iPhone or accurate emulation: drill in and out, confirm back works.
2. Scroll a long list and confirm the last item clears the mini-player.
3. Open a sheet, dismiss it with the keyboard, confirm focus returns.

## Rollback/compatibility

Responsive-only. Reverting degrades mobile to the desktop layout — usable but wrong. No data impact.

## Status

`pending`

## Commit

_(not yet)_
