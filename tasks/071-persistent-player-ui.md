# 071 — Persistent player interface

**Phase:** Persistent player · **Iteration:** one

## Objective

Build the espresso player bar: transport controls, current track display, compact progress, volume, and the entry points to queue and expanded views.

## User value

The player you glance at and reach for constantly — always there, never in the way.

## Scope

- Deep espresso player bar fixed to the bottom, with soft inset control highlights.
- Transport: play/pause, previous, next, seek.
- Current track: artwork, title, artist, version indicator.
- Compact progress with elapsed and remaining time in tabular figures.
- Volume with mute, persisted across sessions.
- Entry points to the queue and the expanded player.
- Full keyboard operation with documented shortcuts, and a visible focus ring on espresso.

## Non-scope

- Waveform (task `072`), queue panel (task `073`), loop and speed (task `074`), A/B (task `075`).
- Mobile mini-player (task `077`).
- Lyrics display in the player.

## Dependencies

`070`, `012`

## Files expected to change

```
apps/web/components/player/**
apps/web/lib/player/shortcuts.ts
apps/web/components/player/__tests__/**
```

## Implementation notes

- Focus rings must be visible against espresso — this is the second ring treatment from task `012`, and the player is where it matters most.
- Timestamps use tabular figures (task `011`) or the digits jitter as the track plays.
- Space toggles play/pause globally, but **not** while focus is in a text input — the lyrics editor is a full-screen typing surface and stealing space there would be intolerable.
- The version indicator must make the current version obvious at a glance, since A/B switching (task `075`) changes it.
- Long titles need graceful truncation with the full value available on hover and to assistive technology.

## Security/privacy considerations

The player displays content metadata; it must only ever show what the user can access. Since it plays what was authorized in task `070`, the constraint holds by construction — but a queue restored from persisted state must re-authorize before displaying (task `073`).

## Acceptance criteria

- [ ] The player bar renders in espresso with correct tokens and inset highlights.
- [ ] Transport controls work and reflect state accurately.
- [ ] Track info shows artwork, title, artist, and version.
- [ ] Progress and time display use tabular figures.
- [ ] Volume persists across sessions.
- [ ] Full keyboard operation works; space does not steal focus from text inputs.
- [ ] Focus rings are visible on espresso.
- [ ] Long titles truncate gracefully with full value available to assistive technology.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Operate the entire player by keyboard.
2. Type in the lyrics editor and confirm space does not toggle playback.
3. Check focus ring visibility on the espresso bar.

## Rollback/compatibility

UI only. Reverting loses the interface; the state machine remains.

## Status

`pending`

## Commit

_(not yet)_
