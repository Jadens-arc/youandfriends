# 055 — Upload interface and progress

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Build the upload surface: drop zones, a persistent upload queue with per-file progress, pause/resume/cancel controls, error recovery, and destination selection.

## User value

Knowing exactly what is uploading, how far along it is, and what to do when something fails.

## Scope

- Drop zones on song, project, and Project Files surfaces with clear destination context.
- A persistent upload tray showing all active uploads across route changes.
- Per-file progress with speed and estimated time remaining.
- Pause, resume, cancel, and retry per file and for the whole queue.
- Error states that say what failed and what to do, distinguishing transient from permanent.
- Destination and asset-kind selection (master, mix, stem, sample, project file, artwork).
- Storage quota awareness with a warning before exceeding it.
- Fill the library's first-run call to action (task `041`): `FirstRunState` in
  `apps/web/components/library/empty-states.tsx` takes an `uploadAction` slot, left empty until
  there is an upload flow to open.

## Non-scope

- The uploader mechanics (task `053`).
- The Mac agent UI (task `116`).
- Background upload after tab close, which browsers do not reliably support — document rather than fake.

## Dependencies

`053`, `054`, `014`, `046`

## Files expected to change

```
apps/web/components/upload/**
apps/web/lib/upload/store.ts
apps/web/components/upload/__tests__/**
```

## Implementation notes

- The upload tray lives in the shell above the route segment, like the player, so navigating away does not cancel uploads.
- Estimated time remaining should be smoothed. A raw instantaneous estimate oscillates wildly and erodes trust more than showing nothing.
- Distinguish transient from permanent failures in the UI. 'Retrying…' and 'Permission denied' need entirely different affordances.
- Warn before a quota is exceeded, not after — a failed finalize at the end of a 2 GB upload is an awful experience.
- Closing the tab cancels in-flight uploads. Warn with `beforeunload` when uploads are active, and be honest in the docs that background upload is not available (`docs/OPERATIONS.md` §9).

## Security/privacy considerations

Destination selection is authorization-sensitive: only destinations the user may write to are offered, filtered server-side, not merely hidden in the picker. Error messages must not leak internal detail — they carry a correlation id instead (task `002`).

## Acceptance criteria

- [x] Drop zones work on all relevant surfaces with clear destination context. (The song page — including its Files tab — and the project page's detail pane, each only for people who may upload there; the overlay says "Drop to upload to <name>" and the dialog is titled with the destination. "Upload files" is the keyboard path to the same dialog.)
- [x] The upload tray persists across route changes. (`UploadTray` in the workspace layout beside the player; the queue is a module-level store read with `useSyncExternalStore`.)
- [x] Per-file progress, speed, and smoothed time estimates display. (Exponentially smoothed speed, estimate refreshed at most once a second and phrased coarsely; `lib/upload/__tests__/store.test.ts` shows a tenfold burst moving the shown rate only part of the way.)
- [x] Pause, resume, cancel, and retry work per file and per queue. (A resumed upload records its version when it finishes; a retry reuses the first attempt's asset so persisted parts resume.)
- [x] Transient and permanent errors are visually and textually distinct. ("Connection trouble — …" with a Wi-Fi-off icon versus the refusal's own sentence with a warning icon.)
- [x] Only writable destinations are offered, filtered server-side. (`GET /api/uploads/destinations`, resolved through one load of the viewer's grants — `lib/assets/__tests__/service.test.ts` covers a song-level deny, a viewer, and a song shared alone. Surfaces render drop zones only when the server said the viewer may edit.)
- [x] Quota warnings appear before the limit is exceeded. (The dialog warns at 90% and refuses before sending when files will not fit; the server now also refuses a session that would exceed `YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES` or a file over `YOUANDFRIENDS_MAX_OBJECT_BYTES`, answering 413.)
- [x] Closing the tab with active uploads warns the user. (`beforeunload` only while something is moving.)

Also: `POST /api/assets` and `POST /api/assets/:assetId/versions` for masters, stems, samples, Project Files, and artwork; the song page's "Upload new version" now goes through the same queue; and the library's first-run state offers "Upload your first song", which creates a project and a song per file and queues each as its first mix. Background upload after the tab closes is not available in browsers and is not pretended — `docs/OPERATIONS.md` §9 already says so.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Upload several files, navigate between routes, confirm the tray persists and uploads continue.
2. Trigger a permission error and confirm the message is clear and actionable.
3. Approach the quota and confirm the warning appears in time.

## Rollback/compatibility

UI only. Reverting loses the interface; the upload API remains.

## Status

`complete`

## Commit

`5376b3c`
