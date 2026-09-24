# 085 — Mobile lyrics experience

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Deliver the full-screen mobile lyrics editor with a compact waveform above it, comfortable typing, and correct keyboard behavior.

## User value

Writing on a phone, on a bus, without fighting the interface.

## Scope

- Full-screen lyrics editor on mobile with a compact waveform above (`docs/DESIGN.md` §6).
- Keyboard-aware layout that keeps the caret visible as the on-screen keyboard appears.
- Touch-friendly block controls at 44×44 px.
- Presence indicators adapted to narrow width.
- Read-only lyric view for viewers and commenters.
- Playback controls reachable without leaving the lyrics surface.

## Non-scope

- Offline lyric editing (deferred `204`).
- Voice dictation beyond the platform keyboard's own.
- Handwriting input.

## Dependencies

`081`, `082`, `083`, `014`

## Files expected to change

```
apps/web/components/lyrics/mobile/**
apps/web/components/lyrics/mobile/__tests__/**
```

## Implementation notes

- iOS Safari's on-screen keyboard is the hard part. Use the Visual Viewport API to keep the caret visible; relying on `vh` or scroll-into-view alone produces a caret hidden behind the keyboard, which makes writing impossible.
- The compact waveform must stay visible while typing so the audio context is not lost — it is the reason for the layout.
- Block controls must be reachable by thumb without covering the text being written.
- Presence at narrow width means avatars, not names — space is scarce.
- Space is the most-typed character here. Confirm the global play/pause shortcut (task `071`) is correctly suppressed while the editor has focus.

## Security/privacy considerations

Same authorization as desktop lyrics. Read-only presentation for viewers and commenters must be genuinely read-only — not an editable field that fails on save.

## Acceptance criteria

- [x] The full-screen editor renders with a compact waveform above it. (On a phone, "Write full screen" — or simply starting to type — turns the lyrics tab into a full-screen surface: the song's title and Done, the compact waveform and play button, then the lyrics. It is the _same_ mounted editor restyled below `md`, so entering and leaving loses nothing; Escape or Done leaves.)
- [x] The caret stays visible as the on-screen keyboard appears and dismisses. (`components/lyrics/mobile/keyboard.ts`: the keyboard's height from the Visual Viewport API — not `vh` — and on every keyboard resize and selection change the lyrics scroll just enough to keep the caret above the keyboard and the docked controls. Arithmetic tested pure; the wiring tested with a resizing visual viewport. **On a real iPhone this is Manual QA 1.**)
- [x] Block controls meet 44×44 px and do not cover the writing area. (Every section control is at least 44 px below `md`; in full screen the controls dock to the bottom, riding above the keyboard, in one scrollable row, and the lyrics end with room for them.)
- [x] Presence adapts to narrow width. (Initials in each person's colour instead of names — the name kept for screen readers and as the title — and connection state in fewer words, never hidden.)
- [x] Viewers and commenters get a genuinely read-only view. (Not editable, no controls, no full-screen writing mode — tested.)
- [x] Playback is controllable without leaving the lyrics surface. (The play button and seekable compact waveform stay above the lyrics in full screen; timestamps (task `083`) still play from their line.)
- [x] Space does not trigger play/pause while editing. (The player's shortcut handler leaves keys to a contenteditable or `role="textbox"`; tested against the real editor, with the same key on the page body shown to reach the player.)

**Fix-up after commit.** The implementation commit carried one lint error (`react-hooks/immutability` in `mobile/keyboard.ts`) that the gate did not catch: `turbo.json` limited the lint and test task inputs to `src/**` and `app/**`, so changes under `apps/web/components/**` and `apps/web/lib/**` hit a stale cache and reported green. A second `085:` commit fixes the error and removes those input restrictions, so every tracked file in a package now invalidates its lint and test cache; a forced lint of every package is clean.

**Not verified here.** Manual QA 1–3 need a real iPhone (task `102`/`120`); jsdom has no layout or on-screen keyboard, so the tests exercise the measurements and wiring, not Safari's rendering.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Write a verse on a real iPhone; confirm the caret is never hidden by the keyboard.
2. Play audio while writing and confirm the waveform stays visible.
3. Open as a commenter and confirm the view is read-only.

## Rollback/compatibility

Mobile UI only. Reverting degrades mobile lyrics to the desktop layout.

## Status

`complete`

## Commit

_(not yet)_
