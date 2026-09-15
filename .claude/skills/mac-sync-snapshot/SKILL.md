---
name: mac-sync-snapshot
description: Ignore rules, stable-folder detection, manifest, ZIP, upload, and recovery for the macOS sync agent. Use for any work in apps/sync-mac.
---

# Mac sync snapshot

The agent touches real project folders on someone's machine. The safety bar is higher here
than anywhere else in the product.

## When to use

Any change to `apps/sync-mac/**`.

## The absolute rules

1. **Never modify or delete anything in the watched folder.**
2. **Never follow a symlink outside the watched root.**
3. **Never write the sync token anywhere but the macOS Keychain.**

Everything else is procedure. These three are invariants.

## Steps

### 1. Watch

Recursive filesystem watching. Handle descriptor limits by reporting the error — a watcher
that has silently died is worse than one that never started.

Handle the watched root being renamed, moved, or deleted: detect, report clearly, stop. Never
follow a rename to an unexpected location.

### 2. Debounce, then confirm stability

Debounce alone is **insufficient**. A DAW saving a project produces bursts including temp
files and atomic renames.

- Quiet period (configurable, default around two minutes) after the last event.
- Then confirm **stability**: sizes and mtimes unchanged across a confirmation interval.
- Only then snapshot.

Snapshotting a mid-write project produces a corrupt archive.

### 3. Ignore rules

Defaults: `.DS_Store`, hidden caches, lock files, temp and partial files, incomplete renders.
Plus user-configured globs.

Rules are **shared** with the browser folder upload path. One definition, two consumers — a
file ignored in one path and uploaded in the other is confusing.

Record **why** each file was ignored. The UI shows the reason.

### 4. Manifest

Relative path, size, mtime, checksum, ignored flag with reason.

**Determinism is the requirement.** Identical folder state must produce a byte-identical
manifest:

- Sort paths with a defined collation.
- Normalize Unicode — macOS uses NFD in filenames, so NFD/NFC variants must not produce
  different manifests.
- Fixed checksum algorithm.
- Stream checksums; never load whole files into memory.

Compare against the last manifest. Unchanged means **no new version** — without this, a nightly
sync buries the version list within a week.

### 5. ZIP

- Temporary location **outside** the watched folder, or creating it triggers the watcher.
- Manifest-driven inclusion only.
- Re-check mtime and size after reading each file; a file that changed mid-ZIP means retry from
  a fresh stable snapshot rather than uploading something inconsistent.
- Check disk space before starting.
- Stream compression.
- Clean up on every exit path, including crash recovery on next start.

### 6. Upload

Identical protocol to the browser uploader — same endpoints, same session model, same
idempotent finalize. Two protocols would be two sets of bugs.

Resumable across app restart. Cancel calls the server abort endpoint.

### 7. Credentials

```bash
grep -rn 'yaf_sync' apps/sync-mac/src-tauri/src --include=*.rs
```

Review every hit. The token lives in the Keychain and nowhere else — not config, not logs, not
Tauri app state that serializes to disk. Check for `Debug` derives on types holding it.

On revocation: report clearly and **stop**. Never retry a dead credential in a loop.

### 8. Recovery

- **Sleep and wake invalidates watchers on macOS.** Re-establish them _and reconcile by
  manifest comparison_ — changes during sleep produced no events. This is the single most
  important resilience behavior; without it a laptop that sleeps overnight silently misses a
  day of work.
- Network loss: back off with jitter.
- App restart: resume in-flight uploads.

### 9. Verify

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
```

Integration tests use a **temporary** fixture folder, never a real project.

## Stop conditions

- A filesystem operation cannot be proven safe against the source folder.
- Keychain access fails under development signing — record the fallback in ADR 0005 rather
  than falling back to plaintext.
- The environment is not macOS — skip **loudly**.
- Manifest determinism cannot be guaranteed.

## Output

```
CHANGE: <summary>
SOURCE UNMODIFIED: checksum before/after — verified
SYMLINK CONTAINMENT: escape blocked — verified
CREDENTIAL: Keychain only · grep clean · no Debug derive
STABILITY: quiet <duration> + confirmation <interval> — verified
MANIFEST: deterministic incl. NFD/NFC — verified · dedup on unchanged: verified
ZIP: outside watched folder · mid-write detection · cleanup on success|failure|crash
PROTOCOL: identical to browser — verified
SLEEP/WAKE: reconcile by manifest — verified
CLIPPY: clean (-D warnings)
TESTS: temporary fixture folder — pass|fail|skipped-loudly
```
