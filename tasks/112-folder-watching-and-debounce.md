# 112 — Recursive folder watching, debounce, and stability detection

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Watch a mapped folder recursively, debounce bursts of filesystem events, and snapshot only after the folder has been quiet for a configurable period.

## User value

Saving in Logic repeatedly without triggering a dozen uploads — and getting one clean snapshot once you stop.

## Scope

- Recursive filesystem watching in Rust with a cross-checked event source.
- Debounce of event bursts with a configurable quiet period.
- Stability detection: file sizes and mtimes unchanged across a confirmation interval before snapshotting.
- Handling of rapid save cycles, large writes in progress, and atomic-rename saves.
- Pause and resume of watching.
- Handling of folder rename, move, and deletion of the watched root.

## Non-scope

- Manifest computation (task `113`), ZIP (task `114`), upload (task `115`).
- Watching multiple folders — one binding for iteration one, with the model allowing more later.
- Real-time file-level sync. This is snapshot sync, deliberately.

## Dependencies

`111`

## Files expected to change

```
apps/sync-mac/src-tauri/src/watch/**
apps/sync-mac/src-tauri/src/stability.rs
apps/sync-mac/src-tauri/src/watch/tests.rs
```

## Implementation notes

- A DAW saving a project produces bursts of events, often including temporary files and atomic renames. Debounce alone is insufficient — confirm **stability** (sizes and mtimes unchanged across an interval) before snapshotting, or you will ZIP a project mid-write.
- Logic project bundles are directories that appear as packages. Treat them as directory trees; do not attempt to interpret their contents (an explicit non-goal).
- Watching a deep tree can hit descriptor limits. Handle the error and report it rather than silently stopping — a watcher that has quietly died is worse than one that never started.
- Handle the watched root being renamed or deleted: report clearly and stop, never follow a rename to an unexpected location.
- The quiet period must be configurable (`docs/DESIGN.md` §9). A default around two minutes suits DAW work; make it adjustable.
- Never modify or delete anything in the source folder. This is an absolute rule stated in the design specification.

## Security/privacy considerations

The agent reads the user's filesystem. It must only read within the mapped folder, never follow symlinks outside it (a symlink escape is a real exfiltration path), and never write to or delete from the source. Path canonicalization and containment checks are mandatory.

## Acceptance criteria

- [ ] Recursive watching detects changes throughout the tree.
- [ ] Event bursts are debounced with a configurable quiet period.
- [ ] Snapshots occur only after sizes and mtimes are stable across a confirmation interval.
- [ ] Rapid save cycles produce one snapshot, not many, proven by test.
- [ ] Symlinks pointing outside the mapped folder are not followed.
- [ ] The source folder is never modified or deleted.
- [ ] Root rename, move, and deletion are handled with a clear report.
- [ ] Watcher failures (descriptor limits) are reported, not silently swallowed.
- [ ] Pause and resume work.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
```

## Manual QA

1. Save a Logic project repeatedly; confirm one snapshot after you stop.
2. Start a large file copy into the folder; confirm no snapshot until the copy completes.
3. Create a symlink to a folder outside the root; confirm it is not followed.
4. Rename the watched folder and confirm a clear report.

## Rollback/compatibility

Agent-only. Reverting loses watching; manual sync remains.

## Status

`pending`

## Commit

_(not yet)_
