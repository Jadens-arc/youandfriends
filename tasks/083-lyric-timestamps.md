# 083 — Lyric timestamp anchors

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Let sections and individual lines carry optional timestamps linking them to positions in the audio, with click-to-seek and follow-along highlighting.

## User value

Jumping straight to the second verse in the audio, and seeing which line is playing while you listen.

## Scope

- Optional timestamp anchors on blocks and on individual lines.
- Setting a timestamp from the current playhead.
- Click a timestamped line to seek the player there.
- Follow-along highlighting of the current line during playback.
- Timestamps rendered in the monospace face with tabular figures.
- Timestamps surviving edits to surrounding text.

## Non-scope

- Automatic lyric alignment or forced alignment.
- Karaoke-style word-level timing.
- Exporting timed lyrics formats.

## Dependencies

`081`, `072`

## Files expected to change

```
apps/web/components/lyrics/timestamps/**
packages/contracts/src/lyrics.ts
apps/web/components/lyrics/__tests__/timestamps.test.tsx
```

## Implementation notes

- Anchor timestamps to block and line **identity**, not to character offsets. Offsets break on every edit above them; stable ids survive.
- Setting from the playhead is the primary interaction — it is how people actually do this while listening. Make it one keystroke.
- Follow-along highlighting must not fight the user's scroll position. Auto-scroll only when the user has not scrolled away recently.
- Timestamps belong to the song, not to a version, since versions share lyrics but may differ in timing. Where they diverge, the timestamp is a best-effort pointer — document this rather than pretending precision.
- Reduced motion applies to follow-along scrolling.

## Security/privacy considerations

Timestamps are lyric metadata with the same sensitivity as lyrics themselves. No additional authorization surface — they travel with the document.

## Acceptance criteria

- [ ] Blocks and lines can carry optional timestamps.
- [ ] Timestamps can be set from the current playhead in one action.
- [ ] Clicking a timestamped line seeks the player.
- [ ] Follow-along highlighting tracks the current line without fighting user scroll.
- [ ] Timestamps survive edits to surrounding text, proven by test.
- [ ] Timestamps render in monospace with tabular figures.
- [ ] Reduced motion disables auto-scroll animation.

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Set timestamps on several sections while listening; confirm each seeks correctly.
2. Edit text above a timestamped line and confirm the timestamp survives.
3. Play through and watch follow-along highlighting; scroll away and confirm it stops fighting you.

## Rollback/compatibility

Additive. Reverting loses timestamps; lyrics text is unaffected.

## Status

`pending`

## Commit

_(not yet)_
