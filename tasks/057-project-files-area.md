# 057 — Project Files: folders and tags

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Build the single, flexible Project Files area with user-created subfolders and tags, for Logic projects, MPC projects, ZIPs, MIDI, presets, and session notes alike.

## User value

One place for everything that is not a mix — organized the way the musician actually thinks, not the way a schema guessed.

## Scope

- One Project Files area per song, with user-created nested subfolders.
- Tagging on assets, with tag creation, assignment, and filtering.
- A file listing with type icons, size, upload time, uploader, and version count.
- Move, rename, and delete within Project Files.
- Snapshot versions from folder uploads and the Mac agent shown as versions of a Project Files entry.
- Filtering and sorting by tag, type, and date.

## Non-scope

- Separate Logic and MPC sections — explicitly forbidden by the confirmed design amendment.
- Server-side inspection or expansion of project bundles.
- Preview rendering of project files.

## Dependencies

`054`, `056`

## Files expected to change

```
apps/web/components/song/files/**
apps/web/app/api/songs/[songId]/files/**
packages/db/src/queries/assets.ts
packages/db/src/schema/tags.ts
```

## Implementation notes

- **There is exactly one Project Files area.** No Logic column, no MPC section, no type-based hard-coded grouping. Organization is folders plus tags, chosen by the user (`docs/DESIGN.md` §2). If a future task proposes splitting this, it contradicts the specification.
- Tags are workspace-scoped and reusable across songs — per-song tags would defeat the purpose of tagging.
- Snapshots appear as versions of a single entry rather than as a flood of new entries, or a nightly Mac sync buries the file list within a week.
- Type icons are derived from extension and magic bytes, presentationally only — never trust them for a security decision.
- Deleting within Project Files is soft deletion (task `025`), recoverable from trash.

## Security/privacy considerations

File names and tags are user input rendered to other users; rely on React escaping. Project bundles are stored opaquely and never inspected or expanded server-side (T4). All operations are authorized and audited.

## Acceptance criteria

- [x] There is exactly one Project Files area with user-created nested subfolders. (`components/song/files/project-files.tsx` on the song's Files tab and the project page; folders are the person's own `assets.folder_path`, created by filing something in them — "Move to folder…" or the upload dialog — and shown nested.)
- [x] Tags can be created, assigned, filtered, and are workspace-scoped. (Typed on a file, normalized case-insensitively, suggested from the workspace vocabulary (`GET /api/tags`); `lib/assets/__tests__/project-files.test.ts` shows one vocabulary per workspace with a populated foreign tenant whose tag never appears. Tags stay on `assets.tags` with a new GIN index rather than a second table that could disagree with it.)
- [x] The listing shows type, size, time, uploader, and version count. (Type from the name, presentational only.)
- [x] Move, rename, and delete work; delete is soft and recoverable. (`PATCH`/`DELETE /api/assets/:assetId`; the trash goes through task `025`'s lifecycle and the test restores it.)
- [x] Snapshot uploads appear as versions of one entry, not as new entries each time. (A folder uploaded again reuses its `snapshot`-tagged ZIP entry; the test uploads twice and finds versions 1 and 2 of one asset.)
- [x] No Logic-specific or MPC-specific section exists anywhere in the code or UI. (The task's `grep` finds nothing; filters are by tag and by generic file type.)
- [x] All operations are authorized and audited. (`edit` on the owning song or project, 404-shaped otherwise; new `asset.updated` action with before/after, migration `0012`; trash writes `asset.deleted`.)

The actions menu itself (Radix `DropdownMenu`) hangs under jsdom when clicked, so the dialog behind each action is tested directly and the menu's interaction is left to task `016`'s real-browser coverage.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
grep -ri 'logic-section\|mpc-section' apps packages && exit 1 || true
```

## Manual QA

1. Upload a Logic project folder and an MPC folder; confirm both land in the same Project Files area.
2. Create subfolders and tags and confirm filtering works.
3. Run the Mac agent twice and confirm the second sync is a new version, not a new entry.

## Rollback/compatibility

Additive. Reverting loses Project Files organization; assets remain.

## Status

`complete`

## Commit

`cdbfa26`
