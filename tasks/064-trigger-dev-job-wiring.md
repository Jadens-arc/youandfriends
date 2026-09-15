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

- [ ] A single idempotent task orchestrates the full pipeline.
- [ ] Retries never duplicate derivatives, proven by a test that retries a partially-completed job.
- [ ] Status updates are transactional.
- [ ] Temporary storage is cleaned on every exit path including failure.
- [ ] The capability probe runs at job start and fails loudly.
- [ ] Job timeouts are enforced.
- [ ] An unreachable dispatcher leaves the job queued and the UI honest — never a fabricated success.
- [ ] `ops:media:retry` works for a single version and for all failed jobs.

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

`pending`

## Commit

_(not yet)_
