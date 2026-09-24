# 065 — Processing status and error surfacing

**Phase:** Media pipeline · **Iteration:** one

## Objective

Show processing state honestly across the UI: queued, processing, complete, or failed, with recoverable errors explained and a retry action for editors.

## User value

Knowing whether a mix is ready to play, still processing, or actually broken — instead of staring at an empty waveform and guessing.

## Scope

- Per-version processing status in the version list and song header.
- Live status updates without requiring a manual reload.
- Distinguishable states: queued, processing, complete, failed.
- Recoverable errors explained in user terms with a retry action for editors.
- Graceful degradation: a song with an unprocessed version still shows what it can.
- Status conveyed by text and icon, never by color alone.

## Non-scope

- The job orchestration itself (task `064`).
- An administrative job dashboard (deferred `207`).
- Automatic retry from the UI beyond an explicit user action.

## Dependencies

`064`, `056`

## Files expected to change

```
apps/web/components/song/processing-status.tsx
apps/web/app/api/versions/[versionId]/retry/route.ts
apps/web/components/song/__tests__/processing-status.test.tsx
```

## Implementation notes

- Live updates can be polling with backoff — a websocket for this is not worth the complexity, and Liveblocks is scoped to lyrics.
- Error messages must be in user terms. 'ffprobe exited 1' is not an error message; 'This file does not appear to be audio we can process' is. Diagnostic detail goes to the log with a correlation id (task `002`).
- Never show a fake progress bar for an unknown-duration job. An honest indeterminate indicator beats a progress bar that stalls at 90%.
- Retry is an editor action and is authorized and audited, not a free button for anyone.
- Status must not be color-only (`docs/DESIGN.md` §12) — pair with icon and text.

## Security/privacy considerations

Error messages carry a correlation id rather than internal detail (task `002`). Retry is authorized through `assertCan` and audited. Job failure reasons must not leak storage keys or internal paths to the client.

## Acceptance criteria

- [x] Processing status is visible per version and in the song header. (Each row of the version list shows its badge in place of a duration until it is ready; the selected version's details show `ProcessingStatus`; the header shows the current — or newest — version's badge while it is not ready.)
- [x] Status updates live without a manual reload. (`useProcessingPoll` in `components/song/processing-status.tsx` polls `GET /api/songs/:songId/versions/status` while any version is queued or processing — 3 s, backing off ×1.5 to 30 s, paused while the tab is hidden — and calls `router.refresh()` when a state changes. A polite live region announces "Version N is ready.")
- [x] Queued, processing, complete, and failed are visually and textually distinct. (Four words, four icons, four badge variants; tested.)
- [x] Errors are explained in user terms with a correlation id, not internal detail. (The pipeline now stores a sentence from `PROCESSING_FAILURE_MESSAGES` in `asset_versions.processing_error` — "This file doesn’t appear to be audio we can process." — and keeps ffprobe's words, which carry paths, in `media_jobs.last_error` only. Editors see the sentence and a reference to quote: the queue's run id or the job's id. Viewers are told only that the version could not be processed. A refused retry shows the server's safe message and its correlation id.)
- [x] Editors can retry a failed job; the action is authorized and audited. (`POST /api/songs/:songId/versions/:versionId/retry` → `retryProcessing` in `lib/versions/processing.ts`: `assertCan(edit)` on the song, the version must belong to that song in this workspace, only a `failed` version, reset guarded on `failed` inside the transaction so two retries become one retry and one conflict, `version.processing_retried` audited, then dispatched under a fresh idempotency key. Commenters, viewers, another song's version, and another workspace's all get a 404-shaped refusal; tested against a real database.)
- [x] No fabricated progress for unknown-duration work. (An indeterminate spinning icon on "Processing", still under reduced motion; no progress bar anywhere — tested.)
- [x] Status is never color-only. (Icon plus word on every badge.)

**Path.** The task names `app/api/versions/[versionId]/retry`; the route lives beside the other version routes at `app/api/songs/[songId]/versions/[versionId]/retry`, because authorization is on the song and a version id alone does not say which song to check.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Upload a file and watch status move from queued to complete without reloading.
2. Upload a non-media file and confirm the failure message is understandable.
3. Retry as a viewer and confirm it is refused.

## Rollback/compatibility

UI only. Reverting hides status; processing continues.

## Status

`complete`

## Commit

_(not yet)_
