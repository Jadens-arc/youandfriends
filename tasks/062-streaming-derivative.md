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

- [x] Every audio version gets an AAC-in-fMP4 derivative with faststart. (`transcodeStreamingDerivative` in `packages/media/src/derivative.ts`: AAC-LC, 44.1 kHz stereo, `+faststart+frag_keyframe+empty_moov+default_base_moof` with ~2 s fragments. It runs for every audio version as a step of task `064`'s job, which is where the pipeline is wired.)
- [x] The original is byte-identical before and after processing, proven by checksum test. (`src/__tests__/derivative.test.ts` hashes the original before and after; the recipe also refuses to write to its input's path or over any existing file — ffmpeg's `-n` exits 0 on the tested build, so existence is checked rather than trusted.)
- [x] Derivatives are stored under their own key prefix with a `derivatives` row. (The derivatives object class in `packages/storage/src/keys.ts` and the existing `derivatives` table; task `064` writes both, under `variantOf(recipe)` = `aac-192k`.)
- [x] Multiple derivatives per version are supported. (Rows are keyed by kind and variant — task `026`'s unique index — so an Opus or HLS row sits beside this one.)
- [x] Bitrate is configurable. (`YOUANDFRIENDS_DERIVATIVE_BITRATE`, validated as `<n>k`; the test encodes at 96k and 256k and sees the size follow.)
- [x] Unusual channel layouts downmix cleanly to stereo. (A 96 kHz 5.1 file becomes 44.1 kHz stereo.)
- [x] Playback starts without downloading the whole file. (The test reads the top-level boxes: `ftyp`, `moov`, then `moof`/`mdat` fragments.)

**Process note.** The implementation commit (`d4c37c7`) was pushed with a failing lint gate: two long ffmpeg flag strings tripped `no-secrets`, and the commit command did not stop on the gate's failure. It was fixed in a follow-up commit (`062: fix lint`) rather than by rewriting pushed history, so this task spans two commits; the gate script now refuses to commit on any failure.

Manual QA in Safari and Chrome, and `pnpm --filter @youandfriends/storage test:contract`, were not run here — there is no browser playback harness yet (task `120`) and MinIO cannot be pulled in this environment.

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

`complete`

## Commit

_(not yet)_
