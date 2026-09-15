# 116 — Menu-bar interface and controls

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Build the agent's interface: pairing, folder mapping, status, Pause and Sync Now controls, ignore configuration, and an honest activity log.

## User value

Seeing at a glance that the Mac is syncing, and being able to stop it or push it without hunting.

## Scope

- Pairing flow: paste the token, validate against the API, store in Keychain, show the bound workspace.
- Folder mapping to an authorized Project Files destination, with destinations fetched from the API rather than typed.
- Menu-bar status: idle, watching, snapshotting, uploading, paused, error.
- Pause and Sync Now controls (`docs/DESIGN.md` §9).
- Ignore-pattern configuration with a preview of what is currently excluded.
- An activity log of recent snapshots with outcome and reason for any skip.
- Studio Notebook styling where practical in a native context.

## Non-scope

- Notarized distribution and auto-update.
- Multiple folder bindings — one for iteration one.
- Full parity with the web UI.

## Dependencies

`115`, `113`

## Files expected to change

```
apps/sync-mac/src/**
apps/sync-mac/src-tauri/src/commands.rs
apps/sync-mac/src/__tests__/**
```

## Implementation notes

- Destinations must be fetched from the API and filtered by what the token may write to. A free-text destination field invites a confusing failure at upload time and leaks nothing useful.
- The status must be honest. 'Synced' when an upload actually failed is the worst possible behavior for a background agent — the user stops checking and discovers the gap much later.
- Show _why_ files were skipped (task `113` records reasons). 'Ignored 47 files' with no explanation is not useful.
- Sync Now should bypass the quiet period but **not** the stability check — forcing a snapshot of a mid-write project produces a corrupt archive.
- Errors need next steps, not codes. 'Token revoked — pair this device again in Settings → Devices' beats a 403.
- Keep the menu compact. A menu-bar app with a sprawling interface is the wrong shape for the job.

## Security/privacy considerations

The pairing UI handles the token briefly in memory before Keychain storage — never persist it in UI state, never log it, and clear the input on completion. Destination lists come from the server, already authorization-filtered.

## Acceptance criteria

- [ ] Pairing validates the token and stores it in the Keychain, clearing the input afterwards.
- [ ] Destinations are fetched from the API and authorization-filtered.
- [ ] Menu-bar status reflects real state and never claims success on failure.
- [ ] Pause and Sync Now work; Sync Now bypasses the quiet period but not the stability check.
- [ ] Ignore patterns are configurable with a preview of exclusions.
- [ ] The activity log shows outcomes and skip reasons.
- [ ] Errors state next steps, not codes.
- [ ] The token never appears in UI state, logs, or config.

## Tests and validation commands

```bash
cd apps/sync-mac && pnpm test
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
```

## Manual QA

1. Pair a device end to end; confirm the token is not recoverable from the UI afterwards.
2. Pause, modify files, confirm nothing syncs; resume and confirm it does.
3. Trigger a failure and confirm status shows the error rather than success.

## Rollback/compatibility

Agent UI only. Reverting loses controls; sync mechanics remain.

## Status

`pending`

## Commit

_(not yet)_
