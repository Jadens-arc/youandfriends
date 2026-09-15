# 117 — Sleep, network, and lifecycle resilience

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Make the agent survive real conditions: sleep and wake, network loss, app restart, expired credentials, renamed folders, and files changing during operations.

## User value

An agent that is still working correctly three weeks later without anyone thinking about it.

## Scope

- Sleep and wake handling: re-establish watching, resume uploads, verify state.
- Network loss and recovery with backoff and no credential retry loops.
- App restart with in-flight upload resumption.
- Expired or revoked credential handling with a clear, actionable state.
- Watched folder renamed, moved, or deleted: detect, report, stop safely.
- Files changing during ZIP or upload, retried from a fresh stable snapshot.
- Launch-at-login as an opt-in setting.

## Non-scope

- Auto-update.
- Crash reporting beyond structured local logs.
- Multi-device coordination.

## Dependencies

`116`, `115`, `112`

## Files expected to change

```
apps/sync-mac/src-tauri/src/lifecycle/**
apps/sync-mac/src-tauri/src/lifecycle/tests.rs
```

## Implementation notes

- Wake from sleep invalidates filesystem watchers on macOS. Re-establish them and **reconcile** — changes during sleep produced no events, so compare the manifest rather than trusting the watcher.
- This reconciliation-on-wake is the single most important behavior in the task. Without it, a laptop that sleeps overnight silently misses a day of changes.
- Never retry a revoked credential in a loop (task `115`). Stop and surface it.
- Back off on network failure with jitter. An agent hammering a failing endpoint is a bad citizen and drains battery.
- Launch-at-login must be opt-in. Silently adding a login item is user-hostile.
- Log to a rotating local file with the redaction rules from task `002` applied, so a user can diagnose without leaking a token.

## Security/privacy considerations

Resilience must never compromise credential handling: no retry loops on revocation, no fallback to a cached credential, no plaintext persistence during recovery. Local logs apply the redaction deny-list and rotate so they do not grow unbounded.

## Acceptance criteria

- [ ] Sleep and wake re-establish watching and reconcile missed changes by manifest comparison.
- [ ] Network loss backs off with jitter and recovers.
- [ ] App restart resumes in-flight uploads.
- [ ] Revoked credentials produce a clear actionable state with no retry loop.
- [ ] Renamed, moved, or deleted watched folders are detected and reported safely.
- [ ] Files changing during operations trigger a retry from a fresh snapshot.
- [ ] Launch-at-login is opt-in.
- [ ] Local logs are rotated and redacted.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
```

## Manual QA

1. Sleep the Mac, change files, wake; confirm changes are detected via reconciliation.
2. Disconnect the network mid-upload, reconnect, confirm resume.
3. Revoke the token and confirm a clear stop with next steps.
4. Rename the watched folder and confirm safe handling.

## Rollback/compatibility

Agent-only. Reverting loses resilience; basic sync remains but becomes unreliable in real use.

## Status

`pending`

## Commit

_(not yet)_
