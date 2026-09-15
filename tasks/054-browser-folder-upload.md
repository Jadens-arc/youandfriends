# 054 — Browser folder upload and snapshots

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Support selecting a whole folder in the browser with `webkitdirectory`, preserving relative paths, applying ignore rules, building a manifest, and creating an immutable snapshot.

## User value

Dragging a Logic project folder into the browser and having it arrive intact, organized, and safe.

## Scope

- Folder selection via `webkitdirectory` and drag-and-drop of directories.
- Relative path preservation with normalization and traversal rejection.
- Default ignore rules: `.DS_Store`, hidden caches, lock files, partial renders, plus configurable patterns.
- A manifest: relative path, size, mtime, checksum, and ignored flag with the reason.
- A pre-upload review showing what will and will not be uploaded, and why.
- Optional client-side ZIP for modest folders, with a clear threshold above which the Mac agent is recommended instead.
- Snapshot finalization creating an immutable Project Files version.

## Non-scope

- The macOS agent (phase 11), which handles large and recurring folders.
- Server-side ZIP expansion — explicitly never done (T4).
- Reconstructing Logic or MPC structures server-side (a stated non-goal).

## Dependencies

`053`, `026`

## Files expected to change

```
apps/web/lib/upload/{folder,ignore-rules,manifest,zip}.ts
apps/web/components/upload/folder-review.tsx
apps/web/lib/upload/__tests__/**
packages/contracts/src/snapshots.ts
```

## Implementation notes

- Normalize every relative path and reject absolute paths, traversal segments, and anything escaping the root — at both client and server (T4). Client-side rejection is UX; server-side rejection is the control.
- The review step matters. Silently ignoring files is how a user discovers at the worst possible moment that their project is incomplete. Show the ignored list with reasons.
- The ZIP threshold should be conservative. Browser-side zipping of a multi-gigabyte folder is slow and memory-hungry; recommend the Mac agent well before that point.
- Uploaded ZIPs are stored and checksummed, **never expanded server-side**. That removes the ZIP-bomb class entirely (T4).
- Ignore rules are shared logic with the Mac agent (task `113`). Put them in a shared module so the two paths cannot drift.
- Never delete or modify local source files. The browser cannot, but the principle is stated here because the Mac agent can.

## Security/privacy considerations

Relative paths are untrusted input and are the path-traversal vector in T4. ZIPs are never expanded server-side. The manifest is validated at the schema boundary (task `026`). Snapshot creation is authorized and audited.

## Acceptance criteria

- [ ] Folder selection preserves relative paths.
- [ ] Paths are normalized; traversal and absolute paths are rejected client- and server-side.
- [ ] Default ignore rules apply and are configurable.
- [ ] The manifest records path, size, mtime, checksum, and ignore reason.
- [ ] The review step shows included and ignored files with reasons before upload.
- [ ] Client ZIP works below the threshold; above it, the Mac agent is recommended.
- [ ] Uploaded ZIPs are never expanded server-side.
- [ ] Snapshots are immutable once finalized.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Upload a nested folder with a `.DS_Store` and confirm it is ignored with a stated reason.
2. Attempt a crafted path containing `../` and confirm rejection.
3. Confirm a finalized snapshot cannot be modified.

## Rollback/compatibility

Additive. Reverting loses folder upload; the Mac agent path remains.

## Status

`pending`

## Commit

_(not yet)_
