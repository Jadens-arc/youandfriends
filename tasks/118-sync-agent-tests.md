# 118 — Sync agent test suite

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Build the agent's test suite: unit tests for ignore rules, stability detection, manifest determinism, and retry state, plus an integration test against a temporary fixture folder.

## User value

The agent keeps behaving correctly as it changes — verified, not hoped.

## Scope

- Unit tests: ignore-rule matching, stability detection, manifest determinism including Unicode normalization, retry state transitions.
- An integration test creating a temporary fixture folder, mutating it, and asserting snapshot behavior end to end.
- Upload protocol tests against MinIO or a mock API, using the real protocol.
- `cargo clippy -- -D warnings` clean.
- Wired into `release-check` with a loud skip on non-macOS.
- A test asserting no credential appears in any log output.

## Non-scope

- Testing against real R2 or a real workspace.
- UI screenshot testing for the agent.
- Load testing.

## Dependencies

`117`

## Files expected to change

```
apps/sync-mac/src-tauri/src/**/tests.rs
apps/sync-mac/src-tauri/tests/integration.rs
scripts/release-check.mjs
```

## Implementation notes

- The integration test must use a **temporary** fixture folder created and destroyed by the test. A test that touches a real project folder is unacceptable given the agent's filesystem access.
- Assert explicitly that the source folder is unmodified after every operation — checksum before and after. This is the agent's most important safety property.
- The credential-leak test should scan captured log output for the `yaf_sync_` prefix. It is cheap and it catches the mistake that matters most.
- Clippy with `-D warnings` from the start. Retrofitting clippy cleanliness onto an established Rust codebase is tedious.
- Loud skip on non-macOS, consistent with tasks `052`, `066`, and `111`.

## Security/privacy considerations

The tests verify T7 controls (no credential in logs, no plaintext persistence) and the filesystem safety properties (no source mutation, no symlink escape). These are security tests, not merely functional ones.

## Acceptance criteria

- [ ] Unit tests cover ignore rules, stability, manifest determinism with Unicode variants, and retry state.
- [ ] An integration test uses a temporary fixture folder and asserts end-to-end snapshot behavior.
- [ ] Upload protocol tests run against MinIO or a mock API using the real protocol.
- [ ] A test asserts the source folder is byte-identical after every operation.
- [ ] A test asserts no credential appears in log output.
- [ ] `cargo clippy -- -D warnings` is clean.
- [ ] The suite is in `release-check` and skips loudly on non-macOS.

## Tests and validation commands

```bash
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
pnpm release-check
```

## Manual QA

1. Run the suite on macOS and confirm it passes.
2. Run `release-check` on Linux and confirm a loud skip.
3. Deliberately log a token and confirm the leak test fails.

## Rollback/compatibility

Test-only. Reverting removes the agent's regression guard.

## Status

`pending`

## Commit

_(not yet)_
