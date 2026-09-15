# 113 — Ignore rules and deterministic manifest

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Implement default and configurable ignore rules and a deterministic snapshot manifest of relative paths, sizes, mtimes, and checksums.

## User value

Uploading the project, not the cache files — and knowing exactly what was and was not included.

## Scope

- Default ignores: `.DS_Store`, hidden caches, lock files, temp and partial files, incomplete renders.
- User-configurable glob patterns.
- A manifest: relative path, size, mtime, checksum, ignored flag with reason.
- Deterministic ordering and normalization so identical folder state yields an identical manifest.
- Manifest comparison for deduplication — an unchanged manifest produces no new version.
- Shared ignore-rule definitions with the browser folder upload path (task `054`).

## Non-scope

- Server-side manifest interpretation beyond storage and validation.
- Per-file selective sync.
- Conflict resolution — this is one-way snapshot upload.

## Dependencies

`112`, `054`

## Files expected to change

```
apps/sync-mac/src-tauri/src/manifest/**
apps/sync-mac/src-tauri/src/ignore.rs
packages/contracts/src/snapshots.ts
apps/sync-mac/src-tauri/src/manifest/tests.rs
```

## Implementation notes

- Determinism is the requirement that makes deduplication work. Sort paths with a defined collation, normalize Unicode (macOS uses NFD in filenames, which will otherwise produce different manifests for identical content), and use a fixed checksum algorithm.
- Manifest comparison prevents a nightly sync from creating an identical version every night — without it the version list becomes useless within a week.
- Ignore rules must match the browser path (task `054`). Keep the rule definitions in a shared, documented location so the two cannot drift; a file ignored in one path and uploaded in the other is confusing.
- Record **why** a file was ignored, not just that it was. The review UI (task `116`) depends on being able to explain it.
- Checksum computation on a large project is I/O-bound. Stream rather than loading files into memory, and report progress.

## Security/privacy considerations

Relative paths are validated and normalized here and again server-side (T4). Never follow symlinks outside the root (task `112`). Checksums enable integrity verification and support the storage reconciliation in `docs/OPERATIONS.md` §5.

## Acceptance criteria

- [ ] Default ignore rules cover `.DS_Store`, caches, locks, temp, and partial files.
- [ ] User-configurable glob patterns work.
- [ ] The manifest records path, size, mtime, checksum, and ignore reason.
- [ ] Identical folder state produces a byte-identical manifest, proven by test, including with NFD/NFC filename variants.
- [ ] An unchanged manifest produces no new version.
- [ ] Ignore rules are shared with the browser upload path and cannot drift.
- [ ] Checksums stream without loading whole files into memory.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
pnpm --filter web test
```

## Manual QA

1. Snapshot a project twice unchanged; confirm no second version is created.
2. Add a `.DS_Store` and confirm it is ignored with a stated reason.
3. Create files with NFD and NFC names; confirm manifest determinism.

## Rollback/compatibility

Agent-only. Reverting loses ignore rules and deduplication.

## Status

`pending`

## Commit

_(not yet)_
