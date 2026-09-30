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

- [ ] A Tauri 2 app builds and runs as a macOS menu-bar item with no dock icon. (**Written, not built.** `src-tauri` sets the `Accessory` activation policy and `LSUIElement`, and builds a tray icon with a status line, "Open…", and "Quit". It could not be compiled here: this is Linux without the macOS SDK. A cross-check for `aarch64-apple-darwin` stops at `objc2-exception-helper`'s C build. See Blocker.)
- [ ] The Rust backend exposes a narrow, typed command surface. (Designed and written: one command, `agent_status`, returning a closed `AgentStatus` from the core crate, whose shape and wording are tested. The Tauri side that exposes it is unbuilt, as above.)
- [x] The React UI builds and uses Studio Notebook tokens where practical. (`@youandfriends/sync-mac`: Vite and React, styled from `@youandfriends/ui`'s own `tokens.css` through Tailwind, not a copied palette. Typecheck, lint, tests, and build pass. It validates the agent's answer rather than trusting it, and shows "unavailable" for an unknown shape.)
- [ ] Development signing works and the notarization path is documented. (Documented in `README.md`: Developer ID certificate, hardened runtime, `notarytool`, `stapler`. `signingIdentity` is null for unsigned development builds. That signing _works_ is unverified without a Mac.)
- [x] `cargo test` and `cargo clippy` run in the quality gates. (A root Cargo workspace beside the Node graph (ADR 0007). The `rust clippy + tests` gate in `release-check` runs `cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`, and it runs here: clean, tests pass. It skips loudly where there is no Rust toolchain.)
- [x] Non-macOS environments skip the build loudly rather than failing confusingly.
  - Tauri is a macOS-only dependency, so off macOS the binary compiles to a stub that prints SKIPPED and exits 2.
  - `tauri:build` / `tauri:dev` print SKIPPED.
  - The `mac agent app (macOS)` gate reports SKIPPED with the platform.
  - All three were seen here.
- [x] Tauri capabilities are minimal; no general filesystem command is exposed. (By construction, checked by reading. `build.rs` declares the app's commands through an app manifest, so each needs a permission. The only capability grants `allow-agent-status` to the one window. No plugin is loaded: no fs, shell, or http. The CSP allows only the app itself and IPC. Tauri's own validation of these files runs only on a macOS build.)

**Structure.**

- `apps/sync-mac/core`, the crate `youandfriends-sync-core`, holds everything that can be platform-independent, so tasks `112`–`115` land where they can be tested anywhere.
- `src-tauri` is a thin macOS shell around it.
- The app icon reuses the product's existing icon rather than inventing one; a full macOS icon set (`.icns`) is for distribution.

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

`blocked`

## Blocker

The menu-bar app must be built and run on a Mac: the build, the no-dock behaviour, development signing, and Tauri's own check of the capability files. This environment is Linux without the macOS SDK. Everything else is done and gated: the core crate, the UI, the Rust gates, and the loud skips. To unblock: on macOS run `pnpm --filter @youandfriends/sync-mac tauri:dev`, confirm a menu-bar item and no dock icon, and fix whatever the first compile of `src-tauri` reports.

## Commit

_(not yet)_
