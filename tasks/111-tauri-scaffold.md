# 111 — Tauri 2 menu-bar application scaffold

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Scaffold `apps/sync-mac`: a Tauri 2 macOS menu-bar application with a Rust backend, a small TypeScript/React UI, and development signing.

## User value

The foundation of the agent that makes recurring project snapshots effortless.

## Scope

- Tauri 2 project with a macOS menu-bar (tray) presence and no dock icon.
- Rust backend with the command surface the UI needs.
- A small React UI sharing Studio Notebook tokens where practical.
- Development signing configuration with a documented path to notarization.
- Cargo workspace integrated into the repository without entangling the Node graph (ADR 0007).
- `cargo test` and `cargo clippy` wired into the quality gates.
- Build instructions in `README.md`, including the macOS-only prerequisite.

## Non-scope

- Folder watching (task `112`), uploads (task `115`), the full UI (task `116`).
- Notarized distribution or auto-update.
- Windows or Linux builds — macOS only, by design.

## Dependencies

`001`, `110`

## Files expected to change

```
apps/sync-mac/**
apps/sync-mac/src-tauri/**
apps/sync-mac/package.json
Cargo.toml
scripts/release-check.mjs
README.md
```

## Implementation notes

- The Rust toolchain sits outside the Node graph (ADR 0007). Keep the Cargo workspace separate and run Rust gates as their own pipeline steps.
- Menu-bar only: no dock icon, `LSUIElement` set. A background sync agent bouncing in the dock is wrong.
- This app can only be built on macOS. CI and contributors on other platforms must **skip loudly**, not fail confusingly — same principle as tasks `052` and `066`.
- Development signing is enough for iteration one. Document the notarization path without doing it now.
- Keep the Rust command surface narrow and well-typed. A wide `invoke` surface between a web UI and a filesystem-capable backend is a security liability (see task `115`).

## Security/privacy considerations

A Tauri app has filesystem access that a browser does not. Restrict the command surface to exactly what the UI needs, validate every argument crossing the IPC boundary, and never expose a general file-read or file-write command. Tauri's allowlist/capabilities must be minimal from the start — widening later is easy, narrowing after shipping is not.

## Acceptance criteria

- [ ] A Tauri 2 app builds and runs as a macOS menu-bar item with no dock icon.
- [ ] The Rust backend exposes a narrow, typed command surface.
- [ ] The React UI builds and uses Studio Notebook tokens where practical.
- [ ] Development signing works and the notarization path is documented.
- [ ] `cargo test` and `cargo clippy` run in the quality gates.
- [ ] Non-macOS environments skip the build loudly rather than failing confusingly.
- [ ] Tauri capabilities are minimal; no general filesystem command is exposed.

## Tests and validation commands

```bash
cd apps/sync-mac && pnpm tauri build --debug
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/sync-mac/src-tauri/Cargo.toml -- -D warnings
```

## Manual QA

1. Build and run on macOS; confirm the menu-bar item appears and the dock does not.
2. Run the gates on a non-macOS machine and confirm a loud skip.

## Rollback/compatibility

New app. Reverting removes the agent entirely; the web upload path is unaffected.

## Status

`pending`

## Commit

_(not yet)_
