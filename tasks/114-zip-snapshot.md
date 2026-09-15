# 114 — Local ZIP snapshot creation

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Create a ZIP of the stable snapshot locally, safely, without mutating the source, and handling files that change during compression.

## User value

One clean archive of the project as it was at a moment in time.

## Scope

- Streaming ZIP creation to a temporary location outside the watched folder.
- Manifest-driven inclusion — only what the manifest lists is included.
- Detection of files changing during compression, with a retry from a fresh stable snapshot.
- Progress reporting for large projects.
- Disk space checking before starting, with a clear error if insufficient.
- Temporary file cleanup on every exit path, including failure and app quit.

## Non-scope

- Server-side ZIP expansion — never done (T4).
- Compression tuning or format alternatives.
- Incremental or differential archives.

## Dependencies

`113`

## Files expected to change

```
apps/sync-mac/src-tauri/src/zip/**
apps/sync-mac/src-tauri/src/zip/tests.rs
```

## Implementation notes

- The temporary ZIP must live **outside** the watched folder, or creating it triggers the watcher and the agent chases its own tail.
- A file changing mid-ZIP produces a corrupt archive of an inconsistent state. Detect it (re-check mtime and size against the manifest after reading each file) and retry from a fresh stable snapshot rather than uploading something inconsistent.
- Check available disk space before starting. A ZIP of a large project that fails halfway on a full disk leaves a mess and a confusing error.
- Clean up temporary files on every exit path, including app quit and crash. Register cleanup on startup for orphans from a previous crash.
- Stream compression; never load a whole project into memory.
- Never modify or delete source files, under any circumstance (`docs/DESIGN.md` §9).

## Security/privacy considerations

ZIPs are created locally and uploaded opaquely; they are **never expanded server-side** (T4), which removes the ZIP-bomb class. The source folder is never mutated. Temporary files are cleaned up and are not left in a world-readable location.

## Acceptance criteria

- [ ] ZIPs are created by streaming, outside the watched folder.
- [ ] Only manifest-listed files are included.
- [ ] Files changing during compression are detected and trigger a retry from a fresh snapshot.
- [ ] Progress is reported for large projects.
- [ ] Insufficient disk space is detected before starting with a clear error.
- [ ] Temporary files are cleaned on every exit path, including crash recovery on next start.
- [ ] Source files are never modified or deleted, proven by checksum test.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
```

## Manual QA

1. ZIP a large project and confirm progress reporting and correct output.
2. Modify a file during compression and confirm detection and retry.
3. Checksum the source folder before and after; confirm it is untouched.
4. Kill the app mid-ZIP and confirm cleanup on next start.

## Rollback/compatibility

Agent-only. Reverting loses snapshot creation.

## Status

`pending`

## Commit

_(not yet)_
