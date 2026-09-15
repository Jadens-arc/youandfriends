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

- [ ] The full-screen editor renders with a compact waveform above it.
- [ ] The caret stays visible as the on-screen keyboard appears and dismisses.
- [ ] Block controls meet 44×44 px and do not cover the writing area.
- [ ] Presence adapts to narrow width.
- [ ] Viewers and commenters get a genuine read-only view.
- [ ] Playback is controllable without leaving the lyrics surface.
- [ ] Space does not trigger play/pause while editing.

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

`pending`

## Commit

_(not yet)_
