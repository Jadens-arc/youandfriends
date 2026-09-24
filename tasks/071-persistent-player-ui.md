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

- [x] The player bar renders in espresso with correct tokens and inset highlights. (`PlayerBar` in `components/player/player-bar.tsx`, in the existing espresso `PlayerRegion`; the play button carries the `shadow-inset` highlight, sliders gained an `espresso` tone in `@youandfriends/ui`.)
- [x] Transport controls work and reflect state accurately. (Play/pause names itself for what it will do and is `aria-busy` while loading or buffering; previous restarts the track; seek is the progress slider. **Next is disabled** — there is no queue until task `073`, and a button that does nothing would be dishonest. The same is true of the queue entry point, labelled "Queue — nothing queued".)
- [x] Track info shows artwork, title, artist, and version. (The project's cover renditions from task `069`, or the designed placeholder; the version as a bordered word, "Version 3", since A/B switching changes it.)
- [x] Progress and time display use tabular figures. (Elapsed and remaining, `tabular` and monospaced, rounded down so the clock never runs ahead; the seek slider speaks "1 minute 23 seconds of 4 minutes 56 seconds".)
- [x] Volume persists across sessions. (Volume and mute in the player state, written to `localStorage` — a per-viewer convenience, never the stream URL — read back on start, and tolerant of storage that throws.)
- [x] Full keyboard operation works; space does not steal focus from text inputs. (Every control is a named button or slider. Shortcuts in `lib/player/shortcuts.ts` — Space/K, ←/→, J/L, M, 0 — are listed in a "Keyboard shortcuts" dialog rendered from the same table, and never fire from a field, a textarea, a contenteditable surface such as the lyrics editor, a slider, a menu, or a button. Tested.)
- [x] Focus rings are visible on espresso. (Every button and slider on the bar uses the on-espresso ring; tested across all of them.)
- [x] Long titles truncate gracefully with full value available to assistive technology. (CSS truncation over the whole text in the DOM, plus a `title` for hover.)

**Also.** A "Play" button on each ready version in the song workspace loads it into the player; on the version already loaded it toggles. An "Expand player" sheet shows the large cover, progress and transport. The mobile mini-player still shows what is playing in words; its controls are task `077`.

**Manual QA** — operating the bar by keyboard in a browser, typing in the lyrics editor (which arrives with task `081`), and checking the ring on the real bar — was not run; there is no browser harness until task `120`.

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

`complete`

## Commit

_(not yet)_
