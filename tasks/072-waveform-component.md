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

- [x] The waveform renders from binary peaks decoded in a worker. (`lib/waveform/decode.worker.ts` decodes off the main thread — importing only `tier.ts`, never the module that creates it — with a main-thread fallback only where `Worker` does not exist. Drawn into a `<canvas>`, one bar per device pixel, by `drawWaveform`.)
- [x] Large and compact variants both work. (Large in the song workspace's waveform region for each ready version; compact, on espresso, in the expanded player.)
- [x] The playhead is precise, linear, and synchronized to playback. (Redrawn every animation frame while this version plays, from the element's own `currentTime` via the new `player.currentTime()` — not from the store's few-times-a-second position, and never a CSS transition.)
- [x] Click and drag seeking works with a hover time preview. (Pointer events with capture; the time under the pointer is shown while hovering or dragging and sought to on release. Clicking a version that is not playing starts it from there — `load` gained `startAt`.)
- [x] Keyboard seeking works at fine and coarse granularity. (Arrows ±5 s, Page Up/Down ±30 s, Home/End.)
- [x] An accessible slider alternative announces time values correctly. (The waveform itself is the slider: `role="slider"`, a name ("Seek in Headlights, Version 3"), min/max/now, and `aria-valuetext` like "1 minute 23 seconds of 3 minutes 20 seconds". The player bar's seek slider remains as well.)
- [x] Peak resolution is selected by rendered width. (`tierForWidth` reads frames per pixel from the file's own header and cuts only that tier — `decodeWaveformTierFor` in contracts — so a narrow view never decodes the fine tier. Tested at three widths.)
- [x] Loading and unavailable states render for versions without peaks. ("Loading waveform…" with `aria-busy`; "will appear once this version has been processed", "not available to you", "not available right now", or "could not be loaded" — each from the server's answer. A version still processing is asked again next time rather than cached as missing.)

**Deviation: peaks are proxied, not presigned.** The task's security note describes presigned URLs. `GET /api/versions/:versionId/waveform` instead reads the peaks from the derivatives bucket and returns the bytes, authorized as `view` on the song on every request (`peaksFor`, tested against a real database, including a short object refused as not ready). The file is tens of kilobytes for a song, no bearer URL for it reaches the browser, and it needs no CORS rule on the bucket. `Cache-Control: private, max-age=300` keeps it in this browser only.

**Not verified here.** Canvas drawing is tested against a recording context — jsdom has no canvas — and pointer seeking against a stubbed layout. Whether the playhead stays on the audio over a long track, and screen-reader announcements in a real browser (Manual QA 1–3), are task `120`'s to confirm.

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

`complete`

## Commit

_(not yet)_
