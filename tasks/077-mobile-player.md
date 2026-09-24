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

- [x] The mini-player sits above bottom navigation and never overlaps content. (A flow sibling above the bottom navigation, as task `014` laid out — artwork, title, state in words, play/pause.)
- [x] Tap and swipe-up both expand to the full-screen player. (The artwork-and-title strip is a button: a tap opens the player, and a vertical swipe up of 32 px or more — mostly vertical — does too; a sideways swipe does not. The chevron button remains for keyboard and assistive technology.)
- [x] The expanded player offers transport, waveform, loop, speed, version switch, and queue. (`MobileExpandedPlayer`: large artwork, the compact waveform, progress, transport, the loaded song's versions with loudness (`VersionPicker`), loop and speed, volume, the queue, and the shortcut list.)
- [x] Swipe-down dismisses back to the mini-player. (The bottom sheet's drag on its header strip — task `014`'s `BottomSheetContent` — plus its close button and Escape.)
- [x] All targets meet 44×44 px. (Every control in the expanded player is `size-11`, `size-14` or `min-h-11`, including the loop buttons, the speed select and each version option; tested.)
- [x] Gestures do not conflict with scrolling or browser back-swipe. (Expand is bound to the mini-player's strip only — the one `touch-none` element — and dismiss to the sheet's header strip; nothing takes a page-wide or edge gesture. Tested structurally; on a real iPhone it is Manual QA 1–2.)
- [x] Reduced motion disables the expand transition. (The sheet's settle spring is off under `prefers-reduced-motion`, and the token layer zeroes transition durations — task `014`'s behaviour, reused rather than duplicated.)
- [x] No desktop control is missing on mobile. (Transport, seek, volume and mute, queue, shortcuts, loop and speed, and version switching are all in the expanded player; tested by name.)

**Also.** The comparison set a song page offers now stays with the player for as long as that song is loaded — loading another song clears it — so the expanded player and the A/V keys work after leaving the song's page.

**Not verified here.** Manual QA 1–3 need a real iPhone.

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

`complete`

## Commit

_(not yet)_
