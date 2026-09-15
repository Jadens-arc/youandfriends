# 115 — Resumable multipart upload from the agent

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Implement resumable multipart upload in Rust with progress, pause, retry, cancel, and Keychain-backed credential storage.

## User value

A large project archive that uploads reliably over an imperfect connection and survives a closed laptop.

## Scope

- Sync token storage in the macOS Keychain via the Tauri keyring plugin (ADR 0005) — never a config file, never a log.
- Upload session creation against the API using the token subject.
- Multipart upload with bounded concurrency, mirroring the browser uploader's protocol (task `053`).
- Progress, pause, resume across app restart, retry with backoff, and cancel that aborts the server session.
- Idempotent finalize creating a new Project Files version.
- Clear handling of an expired or revoked token: report and stop, never retry a dead credential in a loop.

## Non-scope

- The agent UI (task `116`).
- Resilience to sleep and network changes (task `117`).
- A different upload protocol from the browser — the protocol is shared deliberately.

## Dependencies

`114`, `110`, `051`

## Files expected to change

```
apps/sync-mac/src-tauri/src/upload/**
apps/sync-mac/src-tauri/src/credentials.rs
apps/sync-mac/src-tauri/src/upload/tests.rs
```

## Implementation notes

- The token goes to the **Keychain immediately** on pairing and is never written to config, never logged, never persisted in Tauri app state that serializes to disk (ADR 0005). Audit the code for accidental `Debug` derives that would print it.
- The protocol is identical to the browser uploader (task `053`) — same endpoints, same session model, same idempotent finalize. Two protocols would be two sets of bugs.
- Persist upload state so a restart resumes rather than restarting a multi-gigabyte upload.
- On revocation (a 401/403), report clearly and **stop**. Retrying a revoked credential in a loop is how a revoked device generates an alarming audit trail and wastes the user's bandwidth.
- Cancel must call the server abort endpoint so incomplete multipart parts do not accrue billed storage (`docs/OPERATIONS.md` §2).
- Never log the token, presigned URLs, or anything else from the redaction deny-list (task `002`).

## Security/privacy considerations

The primary T7 control on the device side. Keychain storage, no plaintext persistence, no logging of credentials or presigned URLs, and a clean stop on revocation. Server-side enforcement (task `110`) remains the real boundary — the agent is untrusted like any client.

## Acceptance criteria

- [ ] The sync token is stored in the macOS Keychain and never in a file or log, verified by inspection and test.
- [ ] Upload uses the same protocol and endpoints as the browser uploader.
- [ ] Progress, pause, resume across app restart, retry, and cancel all work.
- [ ] Cancel aborts the server session.
- [ ] Finalize is idempotent and creates a new Project Files version.
- [ ] An expired or revoked token reports clearly and stops without a retry loop.
- [ ] No credential or presigned URL appears in any log.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
pnpm --filter @youandfriends/storage test:contract
grep -rn 'yaf_sync' apps/sync-mac/src-tauri/src --include=*.rs   # review every hit
```

## Manual QA

1. Pair a device, upload a snapshot, confirm the version appears in Project Files.
2. Quit the app mid-upload, reopen, confirm resume.
3. Revoke the token mid-upload and confirm a clear stop.
4. Search logs and config for the token; confirm absence.

## Rollback/compatibility

Agent-only. Reverting loses agent upload.

## Status

`pending`

## Commit

_(not yet)_
