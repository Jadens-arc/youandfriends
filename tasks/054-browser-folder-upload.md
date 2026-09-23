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

- [x] Folder selection preserves relative paths. (`lib/upload/folder.ts`: `webkitdirectory` lists and dropped directory trees, rooted inside the chosen folder; `lib/upload/__tests__/folder.test.ts`, including `readEntries` batching.)
- [x] Paths are normalized; traversal and absolute paths are rejected client- and server-side. (`normalizeRelativePath` in `packages/contracts/src/snapshots.ts` mirrors the `snapshot_entries_relative_path_safe` constraint; the server re-judges every path and refuses the whole manifest — `lib/snapshots/__tests__/service.test.ts` posts traversals, absolute, un-normalized, percent-encoded, backslashed, non-ASCII, and duplicate paths directly.)
- [x] Default ignore rules apply and are configurable. (`DEFAULT_IGNORE_RULES` plus caller-supplied patterns with `*`/`**`.)
- [x] The manifest records path, size, mtime, checksum, and ignore reason. (New `snapshot_entries.ignore_reason`, migration `0010`.)
- [x] The review step shows included and ignored files with reasons before upload. (`components/upload/folder-review.tsx`, in a dialog from "Upload folder" on the project page; statuses are words plus icons.)
- [x] Client ZIP works below the threshold; above it, the Mac agent is recommended. (Stored, not deflated, via `fflate`, slice by slice; 512 MiB / 5,000 files ceiling; the test unzips the result and compares bytes.)
- [x] Uploaded ZIPs are never expanded server-side. (No server code opens an archive; the ZIP becomes one version of a Project Files asset.)
- [x] Snapshots are immutable once finalized. (Finalize seals via `finalized_at`; the test tries to rename the snapshot and to edit and delete its entries and each is refused by the existing triggers.)

Golden path and ignore cases live in `packages/contracts/src/snapshots.cases.json` so the Mac agent (task `113`) tests against the same data.

**Limitation, stated plainly:** the path rule is an ASCII allow-list (task `026`'s security review), so files whose names contain accents, emoji, or non-Latin scripts cannot be included yet. The review lists each one as "Can't include" with that reason rather than dropping it silently. Widening the rule safely is follow-up work, not something to loosen here.

The snapshot → asset link (`snapshots.asset_id`) is a composite, same-workspace foreign key with `SET NULL ("asset_id")`, hand-written in `0010` like the file layer's other parent references.

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

`complete`

## Commit

`df5d104`
