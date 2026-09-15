---
name: media-pipeline
description: Validate, analyze, transcode, generate waveforms, and handle retry and idempotency for audio jobs. Use for any change to packages/media or apps/jobs.
---

# Media pipeline

The pipeline reads originals and produces derivatives. It must never damage an original, never
duplicate on retry, and never leave temporary files behind.

## When to use

Any change to `packages/media/**` or `apps/jobs/**`.

## The pipeline

```
download original → ffprobe validate → loudness → derivative → waveform peaks
  → upload derivatives → transactional status update → notify → cleanup
```

Idempotency key: `asset_version_id`.

## Steps

### 1. Capability probe first

```bash
ffmpeg -version
ffmpeg -encoders | grep -E 'aac|libopus'
ffmpeg -filters | grep ebur128
```

The job runs this at startup and **fails loudly** if an encoder or filter is missing. A missing
encoder must never produce a silently broken derivative (ADR 0002, ADR 0004).

### 2. Validate

`ffprobe` → duration, codec, channels, sample rate, bit depth. Parse the JSON with Zod; ffprobe
output varies by build and input.

Reject non-media with a clear reason. A ZIP misclassified as audio fails validation; it does
not crash the transcoder.

### 3. Never damage the original

- Read-only access, always.
- Assert it: checksum the original before and after the job and compare.
- Arguments passed as arrays, never interpolated into a shell string.

### 4. Loudness

EBU R128 integrated (LUFS) and true peak (dBTP), measured on the **original**, not the
derivative.

Handle explicitly: silence yields `-inf`; very short files fall below the gating window and
must be marked unavailable rather than reported as a misleading number.

### 5. Derivative

AAC-LC 192 kbps stereo in fragmented MP4 with `-movflags +faststart` (ADR 0004). Faststart is
not optional — without it playback cannot begin until the whole file downloads.

Bitrate comes from configuration, never a hard-coded constant.

### 6. Waveform peaks

Multi-resolution, compact binary, **deterministic**. The same input must produce byte-identical
peaks, or retries produce visibly different waveforms for identical audio.

Computed from the original, not the lossy derivative.

### 7. Idempotency and retry

- Keyed on `asset_version_id`.
- A retry finds existing derivatives and replaces them deterministically — never appends.
- Derivative upload uses the same key, so re-upload overwrites.
- The final status update is transactional.

### 8. Cleanup and limits

- Temporary files removed on **every** exit path: success, failure, timeout, crash.
- Job timeout enforced. A pathological file fails; it does not hang a worker.
- Bounded temp disk.

### 9. Never fabricate

If the dispatcher is unreachable, the job row stays `queued` and the UI says "processing".
Never write a completed status that did not happen.

### 10. Verify

```bash
pnpm --filter @youandfriends/media test
pnpm --filter @youandfriends/jobs test
```

Fixture tests run the **real** pipeline via `InlineDispatcher` — the pipeline itself is never
mocked, only its scheduling.

## Stop conditions

- A required encoder or filter is missing — report it; do not work around it.
- Retry would duplicate a derivative row.
- The original's checksum changes.
- Temp cleanup cannot be guaranteed on some exit path.
- ffmpeg is unavailable — tests skip **loudly**.

## Output

```
CHANGE: <summary>
CAPABILITY PROBE: aac|libopus|ebur128 — present
ORIGINAL CHECKSUM: unchanged — verified
LOUDNESS: measured on original · silence and short-file cases handled
DERIVATIVE: AAC-LC <bitrate> fMP4 faststart — verified
PEAKS: deterministic (byte-identical on re-run) — verified
IDEMPOTENCY: retry replaces, never appends — verified
CLEANUP: success|failure|timeout|crash — all verified
TIMEOUT: <duration> enforced
FIXTURE TESTS: pass|fail|skipped-loudly
```
