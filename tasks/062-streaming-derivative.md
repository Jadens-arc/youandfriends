# 062 — AAC streaming derivative

**Phase:** Media pipeline · **Iteration:** one

## Objective

Produce a fast-starting AAC-in-fragmented-MP4 streaming derivative for every audio version, without touching the original (ADR 0004).

## User value

Playback that starts immediately on a phone, and seeking that actually works — while the lossless original stays exactly as uploaded.

## Scope

- AAC-LC 192 kbps stereo in fragmented MP4, 44.1 kHz (ADR 0004).
- `faststart` so the moov atom is at the front and playback begins without downloading the whole file.
- Derivative stored under the derivatives key prefix, never replacing the original.
- A `derivatives` row per version, supporting multiple derivatives for the deferred Opus (`205`) and HLS (`206`) work.
- Configurable bitrate rather than a hard-coded constant.
- Graceful handling of unusual channel layouts by downmixing to stereo.

## Non-scope

- Opus derivative (deferred `205`).
- HLS adaptive streaming (deferred `206`).
- Any modification of the original, under any circumstance.

## Dependencies

`060`, `061`

## Files expected to change

```
packages/media/src/derivative.ts
packages/db/src/schema/derivatives.ts
packages/media/src/__tests__/derivative.test.ts
```

## Implementation notes

- `-movflags +faststart` is not optional. Without it the player must download the entire file before it can begin, which defeats the whole purpose of the derivative.
- Fragmented MP4 gives reliable byte-range seeking, which waveform scrubbing (task `072`) and A/B switching (task `075`) depend on.
- The original is read, never written. Assert this in a test that checksums the original before and after the job.
- Downmix surround or unusual layouts to stereo for the derivative. The original retains its full layout for download.
- Bitrate is configuration (`YOUANDFRIENDS_DERIVATIVE_BITRATE`), so adjusting quality is not a code change (ADR 0004).
- ADR 0004 requires re-verifying Safari's Opus support before task `102`. If it has become dependable, an additional Opus derivative is additive here, not a rewrite.

## Security/privacy considerations

The original's immutability is a data-integrity control (T8) and is asserted by checksum test. Derivatives are written to private keys and served only through short-TTL presigned URLs after authorization (T3).

## Acceptance criteria

- [ ] Every audio version gets an AAC-in-fMP4 derivative with faststart.
- [ ] The original is byte-identical before and after processing, proven by checksum test.
- [ ] Derivatives are stored under their own key prefix with a `derivatives` row.
- [ ] Multiple derivatives per version are supported.
- [ ] Bitrate is configurable.
- [ ] Unusual channel layouts downmix cleanly to stereo.
- [ ] Playback starts without downloading the whole file.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
pnpm --filter @youandfriends/storage test:contract
```

## Manual QA

1. Transcode each fixture format and play the result in Safari and Chrome.
2. Checksum an original before and after processing; confirm they match.
3. Seek to the middle of a long derivative and confirm it does not buffer the whole file.

## Rollback/compatibility

Additive; derivatives are regenerable. Reverting and regenerating is always safe because originals are untouched.

## Status

`pending`

## Commit

_(not yet)_
