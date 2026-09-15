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

- [ ] Processing status is visible per version and in the song header.
- [ ] Status updates live without a manual reload.
- [ ] Queued, processing, complete, and failed are visually and textually distinct.
- [ ] Errors are explained in user terms with a correlation id, not internal detail.
- [ ] Editors can retry a failed job; the action is authorized and audited.
- [ ] No fabricated progress for unknown-duration work.
- [ ] Status is never color-only.

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

`pending`

## Commit

_(not yet)_
