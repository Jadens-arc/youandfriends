# 064 — Trigger.dev job orchestration

**Phase:** Media pipeline · **Iteration:** one

## Objective

Wire the media pipeline into Trigger.dev v3 with the ffmpeg build extension: one idempotent task orchestrating probe, loudness, derivative, and peaks, with retries and transactional status updates.

## User value

Uploads process reliably in the background, retry safely when something goes wrong, and never produce duplicate or half-finished results.

## Scope

- `apps/jobs` with Trigger.dev v3 and the `ffmpeg()` build extension (ADR 0002).
- One audio-processing task keyed by `asset_version_id` for idempotency.
- Orchestration: download original → probe → loudness → derivative → peaks → upload → update status transactionally → emit notifications.
- Retry with backoff; retries must never duplicate derivative rows.
- Temporary storage cleanup on every exit path, including failure.
- `media_jobs` state tracking with attempt count and last error.
- Operational scripts: `ops:media:retry` for one version and for all failed.

## Non-scope

- The job status UI (task `065`).
- Notification delivery (phase 9) — this task emits the events.
- Self-hosted worker fallback (documented escape hatch in ADR 0002).

## Dependencies

`060`, `061`, `062`, `063`, `051`

## Files expected to change

```
apps/jobs/src/**
apps/jobs/trigger.config.ts
packages/db/src/schema/media_jobs.ts
apps/jobs/src/__tests__/**
packages/media/src/dispatcher.ts
```

## Implementation notes

- Idempotency is keyed on `asset_version_id`. A retry must find existing derivatives and skip or replace them deterministically — never append a second row (T4-adjacent; the same duplicate-work class).
- The final status update must be transactional. A job that uploads derivatives then fails before the status update must be safely retryable, which means the upload step must be idempotent too — same key, overwrite.
- Clean up temporary storage on **every** exit path. A 2 GB temp file left behind on failure exhausts disk within a handful of failures.
- Fail loudly on the capability probe from task `060` at job startup, before doing any work.
- When the dispatcher is unreachable in development, the job row stays `queued` and the UI shows processing. **Never** fabricate a completed status — that is exactly the 'fabricated provider response' the build prompt forbids.
- Enforce a job timeout. A pathological file must fail, not hang a worker indefinitely.

## Security/privacy considerations

Jobs handle untrusted user files with bounded time and disk. Job credentials are scoped to what the job needs: read originals, write derivatives, update its own rows. Errors are logged with correlation ids and never expose presigned URLs or credentials (T3, task `002`).

## Acceptance criteria

- [x] A single idempotent task orchestrates the full pipeline. (`processAudio` in `apps/jobs/src/trigger/process-audio.ts`, id `process-audio`, wraps `processAudioVersion` in `apps/jobs/src/pipeline.ts`: download → validate/probe → loudness → AAC derivative → peaks → upload → one transaction → notify. The job's identity is its `media_jobs` row, unique per `(workspace_id, asset_version_id)`; a completed job is a no-op on replay.)
- [x] Retries never duplicate derivatives, proven by a test that retries a partially-completed job. (`src/__tests__/pipeline.test.ts` stops the first attempt at two points — after the stream was uploaded but before it was recorded, and after it was recorded — and retries: one row per kind, one storage object per key, and a recorded stream is not transcoded or uploaded again. A derivative's object key is derived from its row's id (`derivativeObjectKey`), so a retry overwrites instead of orphaning. Mutation-checked: removing the skip, or giving each attempt a fresh key, fails by name.)
- [x] Status updates are transactional. (Each derivative commits with its storage object; the version's analysis, the song's duration, and the job's `complete` commit in one transaction; a failure writes the job and the version together.)
- [x] Temporary storage is cleaned on every exit path including failure. (`withTempWorkspace`; the test checks for leftovers after a success, a rejected non-audio file, and a failed attempt.)
- [x] The capability probe runs at job start and fails loudly. (Before any row is written or byte downloaded; the test proves nothing is touched. The worker memoizes a successful probe only.)
- [x] Job timeouts are enforced. (A whole-job deadline, `JOB_TIMEOUT_MS` = 55 min, feeds the remaining time into every ffmpeg timeout and the download's abort signal; Trigger.dev's `maxDuration` sits five minutes above it. Tested: a timed-out final attempt is recorded `failed` with the reason.)
- [x] An unreachable dispatcher leaves the job queued and the UI honest — never a fabricated success. (`enqueueMediaJob` writes the row `queued` before dispatching. Tested with the real Trigger.dev SDK pointed at a port nothing listens on, and with no queue configured: the job stays `queued` with the reason, and the version's `processing_state` — what the version selector reads — stays `queued`.)
- [x] `ops:media:retry` works for a single version and for all failed jobs. (`--version <id>`, `--all-failed`, `--stranded`, `--workspace`, `--limit`, `--inline`, `--dry-run`; a retry uses a new idempotency key, since the queue remembers the old one. Tested: a failed job retried to completion through a dispatcher that remembers keys; `--all-failed` finds failed jobs across workspaces and never complete ones or a live running one.)

**Also in this task.** `ObjectTransfer` in `packages/storage` (whole-object download to a file with a byte cap, and upload that refuses any original's key) — the web tier's `StorageDriver` only signs URLs. `songs.duration_ms` now follows the current version when it is changed. Two notification events, `version.processed` and `version.processing_failed`, are emitted through an injectable sink; delivery arrives with `095`–`096`. The web tier enqueues through `onVersionRecorded` (task `056`'s hook). `media_jobs` is in the scoped-table list and the IDOR registry.

**Trigger.dev SDK version.** ADR 0002 names v3; the current SDK is v4 (`@trigger.dev/sdk` 4.6), the same `task()` model with v3's API at its root. Recorded in the ADR.

**Not run here, and why.** `pnpm --filter @youandfriends/jobs dev` and manual QA 1–3 need a Trigger.dev project, its secret key, and R2 credentials, none of which this environment has. The storage contract case for `ObjectTransfer` is written but MinIO cannot be pulled here, so it skips loudly. `ops:media:retry` was run for its argument handling only; the local dev database was not migrated.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/jobs test
pnpm --filter @youandfriends/media test
pnpm --filter @youandfriends/jobs dev   # local execution
```

## Manual QA

1. Upload audio and watch the job complete end to end.
2. Kill the job mid-run and retry; confirm no duplicate derivatives.
3. Stop the dispatcher, upload, and confirm the UI says processing rather than complete.

## Rollback/compatibility

Additive, separate deploy target. Reverting leaves uploads unprocessed but loses no originals — derivatives regenerate.

## Status

`complete`

## Commit

`1747ccb`
