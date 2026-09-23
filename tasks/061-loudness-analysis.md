# 061 — EBU R128 loudness and true peak analysis

**Phase:** Media pipeline · **Iteration:** one

## Objective

Measure integrated loudness and true peak for every audio version, store the results, and surface them in the version list.

## User value

A mixing engineer can see at a glance whether the new mix is louder than the last one — which is most of what A/B comparison is actually for.

## Scope

- EBU R128 integrated loudness (LUFS) via the ffmpeg `ebur128` filter.
- True peak (dBTP) measurement.
- Loudness range where cheaply available.
- Storage on the version record and display in the version list.
- Handling of edge cases: silence, very short files, mono, and unusual sample rates.

## Non-scope

- Loudness normalization of playback — we measure, we do not alter (ADR 0004: originals untouched).
- Automatic mastering or correction suggestions.
- Per-section or time-varying loudness display.

## Dependencies

`060`

## Files expected to change

```
packages/media/src/loudness.ts
packages/db/src/schema/versions.ts
apps/web/components/song/versions/version-row.tsx
packages/media/src/__tests__/loudness.test.ts
```

## Implementation notes

- Digital silence yields `-inf` LUFS. Handle it explicitly — an `-inf` rendered into the UI as a number is a visible bug, and stored as a float may not round-trip.
- Very short files (under the R128 gating window) produce unreliable integrated values. Detect and mark as unavailable rather than reporting a misleading number.
- Measurement runs on the original, never on the derivative — the derivative's loudness is not the mix's loudness.
- One ffmpeg pass can produce both loudness and the streaming derivative; combining them saves reading a 2 GB file twice. Do this if it does not complicate retry semantics.
- Display with correct units and sensible precision: LUFS to one decimal, dBTP to one decimal.

## Security/privacy considerations

Measurement only — no modification of user audio. Bounded processing time applies as in task `060`. A file that resists analysis fails the job cleanly rather than hanging it.

## Acceptance criteria

- [x] Integrated loudness and true peak are measured for every audio version. (`measureLoudness` in `packages/media/src/loudness.ts`: one ffmpeg `ebur128=peak=true` pass. It runs for every audio version as a step of the orchestrated job in task `064`, which is where the pipeline is wired — this task provides the measurement and its storage.)
- [x] Values are stored and displayed with correct units and precision. (`asset_versions.integrated_lufs`/`true_peak_db` already existed; migration `0015` adds `loudness_range_lu` and `loudness_unavailable`. Shown as "−14.2 LUFS", "−1.0 dBTP", "5.2 LU", one decimal each, with a real minus sign.)
- [x] Silence, very short files, mono, and unusual sample rates are handled explicitly. (`src/__tests__/loudness.test.ts` against real ffmpeg: silence is `silent` with no `-inf` anywhere, a 1 s tone is `too_short` but keeps its peak, a 22.05 kHz mono tone measures about 3 dB below the same tone in stereo.)
- [x] Measurement runs on the original, not the derivative. (The function takes the original's path; task `064` passes it the downloaded original.)
- [x] Unreliable measurements are marked unavailable rather than shown as misleading numbers. (The version details say "Silent", "Too short to measure", or "Could not be measured".)

Tolerance-based assertions against generated tones: a half-scale sine's true peak is −6 dBFS, and halving the amplitude lowers loudness and peak by 6 dB. No committed audio.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
```

## Manual QA

1. Analyze a known-loudness fixture and confirm the value is correct within tolerance.
2. Analyze a silent file and confirm it is handled without an `-inf` leaking to the UI.
3. Compare two mixes in the version list and confirm the loudness difference is visible.

## Rollback/compatibility

Additive columns. Reverting loses loudness display; audio is unaffected.

## Status

`complete`

## Commit

`3e3d092`
