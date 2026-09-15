# 077 — Mobile mini-player and expanded player

**Phase:** Persistent player · **Iteration:** one

## Objective

Build the mobile playback surfaces: a mini-player above the bottom navigation and a full-screen expanded player with the complete control set.

## User value

Listening and working on a phone without feeling like you are using a shrunken desktop app.

## Scope

- Mini-player docked above bottom navigation showing artwork, title, and play/pause.
- Tap or swipe up to expand to the full-screen player.
- Expanded player: large artwork, waveform, full transport, loop, speed, version switch, queue access.
- Swipe down to dismiss back to the mini-player.
- 44×44 px minimum targets throughout.
- Gesture handling that does not conflict with page scrolling or browser back-swipe.

## Non-scope

- Offline download controls (deferred `203`).
- Lyrics display in the expanded player — lyrics have their own full-screen surface (task `085`).
- Native-only gestures the web cannot support reliably.

## Dependencies

`071`, `072`, `074`, `075`, `014`

## Files expected to change

```
apps/web/components/player/mobile/**
apps/web/components/player/mobile/__tests__/**
```

## Implementation notes

- Swipe gestures must not fight iOS Safari's edge back-swipe. Constrain the expand gesture to the mini-player region rather than the whole screen.
- The expanded player uses dynamic viewport units (task `014`) so it behaves as the Safari URL bar collapses.
- Every control the desktop player has must be reachable on mobile — the phone is a working surface, not a viewer (`docs/DESIGN.md` §1). Do not quietly drop loop or speed.
- Respect `prefers-reduced-motion`: the expand transition falls back to instant.
- The waveform in the expanded player should use a lower peak resolution suited to the narrower width (task `072`).

## Security/privacy considerations

Same authorization model as desktop playback. No additional surface. The expanded player must not expose actions the user's role does not permit.

## Acceptance criteria

- [ ] The mini-player sits above bottom navigation and never overlaps content.
- [ ] Tap and swipe-up both expand to the full-screen player.
- [ ] The expanded player offers transport, waveform, loop, speed, version switch, and queue.
- [ ] Swipe-down dismisses back to the mini-player.
- [ ] All targets meet 44×44 px.
- [ ] Gestures do not conflict with scrolling or browser back-swipe.
- [ ] Reduced motion disables the expand transition.
- [ ] No desktop control is missing on mobile.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. On a real iPhone, expand and dismiss the player by gesture and by tap.
2. Confirm the back-swipe still works from the expanded player.
3. Verify every desktop control is present.

## Rollback/compatibility

Mobile UI only. Reverting degrades mobile playback to the desktop bar.

## Status

`pending`

## Commit

_(not yet)_
