# 072 — Waveform rendering and seeking

**Phase:** Persistent player · **Iteration:** one

## Objective

Render the multi-resolution waveform with a precise playhead, click and drag seeking, and fully accessible keyboard and textual alternatives.

## User value

The visual anchor for listening and for every timestamp-based conversation about a mix.

## Scope

- Canvas rendering of the binary peak data from task `063`, decoded in a worker.
- Large waveform on song views; compact progress elsewhere.
- Linear, precise playhead motion synchronized to `currentTime`.
- Click and drag to seek, with a hover preview of the target time.
- Keyboard seeking: arrow keys for fine, page keys for coarse, Home/End for boundaries.
- A textual alternative: an accessible slider with proper ARIA and announced time values.
- Loading and unavailable states for versions whose peaks are not yet generated.

## Non-scope

- Peak generation (task `063`).
- Loop region UI (task `074`).
- Comment markers on the waveform (task `091`).

## Dependencies

`063`, `071`

## Files expected to change

```
apps/web/components/player/waveform/**
apps/web/lib/waveform/decode.ts
apps/web/components/player/waveform/__tests__/**
```

## Implementation notes

- Canvas, not SVG or DOM elements. A waveform with thousands of bars as DOM nodes is a performance disaster on mobile.
- Decode the binary format in a worker; decoding on the main thread stutters playback on a phone.
- Playhead motion must be linear and precise (`docs/DESIGN.md` §11) — drive it with `requestAnimationFrame` against `currentTime`, not a CSS transition, which will drift.
- The accessible alternative is **required**, not optional (`docs/DESIGN.md` §12). A canvas waveform is invisible to assistive technology, so the slider is the real interface for some users and must be genuinely usable, not a token element.
- Choose the peak resolution by rendered width so a narrow compact view does not decode full-detail data.
- Redraw on resize with debouncing; a canvas redrawn on every resize frame janks badly.

## Security/privacy considerations

Peak data is served via authorized short-TTL presigned URLs (task `063`). The waveform reveals structure and length of unreleased music and is treated with the same care as the audio.

## Acceptance criteria

- [ ] The waveform renders from binary peaks decoded in a worker.
- [ ] Large and compact variants both work.
- [ ] The playhead is precise, linear, and synchronized to playback.
- [ ] Click and drag seeking works with a hover time preview.
- [ ] Keyboard seeking works at fine and coarse granularity.
- [ ] An accessible slider alternative announces time values correctly.
- [ ] Peak resolution is selected by rendered width.
- [ ] Loading and unavailable states render for versions without peaks.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/media test
```

## Manual QA

1. Seek by click, drag, and keyboard; confirm all three land accurately.
2. Navigate the waveform with a screen reader and confirm times are announced.
3. Play a long track and confirm the playhead does not drift from actual position.

## Rollback/compatibility

UI only. Reverting loses waveform seeking; the accessible slider must remain regardless.

## Status

`pending`

## Commit

_(not yet)_
