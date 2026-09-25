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

- [x] Blocks and lines can carry optional timestamps. (`timestampMs` on the section and line nodes, as the contract already allowed — `components/lyrics/timestamps/extension.ts`. They travel with the document, through Yjs as node attributes when editing together.)
- [x] Timestamps can be set from the current playhead in one action. (Mod-Alt-T times the line with the cursor; Mod-Alt-Shift-T its section; "Time this line" / "Time <section>" in the section toolbar. Taken from the player's own playhead, and only when **this** song is the one loaded — otherwise nothing is set and the editor says "Play this song first".)
- [x] Clicking a timestamped line seeks the player. (Each timestamp is a button at the start of its line, or beside its section heading, named "Play Verse 2 from 1:23": it seeks and plays the loaded song, or loads the song's current playable version there. Viewers can use them too.)
- [x] Follow-along highlighting tracks the current line without fighting user scroll. (The line whose moment has most recently passed — by time, not document order, so an out-of-order chorus works — is marked `aria-current` with a bar and a tint. It is scrolled into view only when the person has not wheeled, swiped, or pressed a scrolling key in the last 4 seconds — tested both ways.)
- [x] Timestamps survive edits to surrounding text, proven by test. (Typing above, adding lines above, retyping the stamped line, splitting it — the stamp stays on the original, not the continuation — and moving its section; mutation-checked.)
- [x] Timestamps render in monospace with tabular figures. (`.lyrics-timestamp`: the mono face and `tabular-nums`.)
- [x] Reduced motion disables auto-scroll animation. (`behavior: 'auto'` under `prefers-reduced-motion` — tested.)

**Versions.** Timestamps belong to the song, not a version; the shortcut list says that on a version with different timing they are approximate.

**Not verified here.** Manual QA 1–3 need a browser and real audio (task `120`).

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

`complete`

## Commit

`f526fde`
