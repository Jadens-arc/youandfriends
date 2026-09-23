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

`053`, `054`, `014`

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

- [ ] Drop zones work on all relevant surfaces with clear destination context.
- [ ] The upload tray persists across route changes.
- [ ] Per-file progress, speed, and smoothed time estimates display.
- [ ] Pause, resume, cancel, and retry work per file and per queue.
- [ ] Transient and permanent errors are visually and textually distinct.
- [ ] Only writable destinations are offered, filtered server-side.
- [ ] Quota warnings appear before the limit is exceeded.
- [ ] Closing the tab with active uploads warns the user.

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

`pending`

## Commit

_(not yet)_
