# 063 — Multi-resolution waveform peak generation

**Phase:** Media pipeline · **Iteration:** one

## Objective

Generate compact multi-resolution waveform peak data for every audio version, so the waveform renders instantly at any zoom level.

## User value

The waveform that anchors listening, timestamp comments, and scrubbing — visible immediately rather than computed in the browser.

## Scope

- Peak extraction at several resolutions (overview through detail).
- A compact binary format with a documented header, far smaller than JSON.
- Storage as a derivative under the derivatives prefix.
- A documented format specification so the client decoder and the generator cannot drift.
- Handling of mono, stereo, and multichannel sources.
- Deterministic output: the same input always yields identical peaks.

## Non-scope

- Waveform rendering (task `072`).
- Spectrogram or frequency display.
- Client-side peak computation as a fallback — the server always generates peaks.

## Dependencies

`060`, `062`

## Files expected to change

```
packages/media/src/waveform.ts
packages/media/src/waveform-format.md
packages/media/src/__tests__/waveform.test.ts
```

## Implementation notes

- JSON peaks for a long track are large enough to hurt on mobile. A compact binary format (Int8 or Int16 min/max pairs) is an order of magnitude smaller and decodes fast in the client.
- Multiple resolutions mean zooming does not require re-fetching full-detail data for a whole track. Generate an overview tier plus one or two detail tiers.
- Determinism matters: identical input must produce identical peaks, or retries produce visibly different waveforms for the same audio and users reasonably conclude something is broken.
- Document the binary format in the repository. An undocumented binary format between a generator and a decoder is a maintenance trap.
- Peaks are computed from the original for accuracy, not from the lossy derivative.

## Security/privacy considerations

Peaks are derived data with no additional sensitivity beyond the audio itself, but they are still served through authorized, short-TTL presigned URLs — a waveform reveals structure and length of unreleased music.

## Acceptance criteria

- [ ] Peaks are generated at multiple resolutions for every audio version.
- [ ] The binary format is compact and documented in the repository.
- [ ] Output is deterministic for identical input, proven by test.
- [ ] Mono, stereo, and multichannel sources are handled.
- [ ] Peaks are computed from the original, not the derivative.
- [ ] Peak data is served only through authorized presigned URLs.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
```

## Manual QA

1. Generate peaks for a fixture and confirm the rendered shape matches the audio.
2. Regenerate and confirm byte-identical output.
3. Compare payload size against an equivalent JSON encoding.

## Rollback/compatibility

Additive derivative. Regenerable at any time from originals.

## Status

`pending`

## Commit

_(not yet)_
