# ADR 0005: Scoped sync tokens in the macOS Keychain for the sync agent

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

`apps/sync-mac` is a Tauri 2 menu-bar agent that watches a local folder and uploads immutable
snapshots into the Project Files area. It runs unattended on the user's Mac, often for weeks,
and must authenticate to the API to create upload sessions.

Clerk's browser session model does not fit a long-lived native background process. Embedding
a workspace-wide credential in a desktop app that sits on disk is unacceptable: a stolen
laptop would yield full workspace access.

## Decision

Authenticate with a **user-generated, scoped, revocable sync token**, stored in the macOS
Keychain.

**Shape.** `yaf_sync_<26-char-ULID>_<32-byte-base62-secret>`. The prefix aids secret scanning
and support; the ULID is the lookup key; only the secret is sensitive.

**At rest on the server.** We store the ULID in cleartext (indexed) and an **Argon2id hash**
of the secret. Lookup is by ULID, then constant-time verification of the hash. The full token
is displayed to the user exactly once, at creation.

**Scope.** Each token binds to one workspace and an explicit allow-list of destination
project/song IDs. A token may only create upload sessions targeting Project Files within its
allow-list. It cannot read lyrics, post comments, manage permissions, mint share links, or
delete anything. Server-side enforcement runs through the same `packages/authz` resolution as
any other subject — the token is a subject type, not a bypass.

**On the device.** The secret is written to the macOS Keychain via the Tauri keyring plugin,
never to a plaintext config file, never to logs, never to Tauri app state that serializes to
disk. Pairing happens in the browser: the web app shows the token once, the user pastes it
into the agent, and the agent immediately moves it to the Keychain.

**Lifecycle.** Tokens carry `last_used_at` and an optional expiry, appear in a device list in
settings with their bound folder, and are revocable instantly. Revocation takes effect on the
next request — the agent surfaces a clear "this device was disconnected" state and stops,
rather than retrying a dead credential in a loop.

## Consequences

**Easier:** A stolen laptop exposes append-only access to one folder destination in one
workspace, not the workspace. Revocation is a single row update. The token is a first-class
audited subject, so every sync upload appears in the audit log attributed to a named device.

**Harder:** A second authentication path to keep correct and test. Task `023`'s matrix tests
must cover the sync-token subject explicitly, including the negative cases — a sync token
attempting to read another workspace's song, or to write outside its destination allow-list.

**Accepted:** Users must copy a token once during pairing. A tidier OAuth device flow is
better UX but is materially more work for iteration one; the seam is recorded as deferred
task `213`.

## Assumptions to re-verify

- The Tauri 2 keyring plugin reaches the macOS Keychain reliably under a development signing
  identity. If development signing blocks Keychain access, fall back to an encrypted file
  keyed by a Keychain-held key, and record the change here.
- Argon2id parameters remain appropriate; revisit with general password-hashing guidance.

## Alternatives considered

**Clerk session token in the native app** — reuses existing auth, but requires an embedded
browser, breaks unattended operation when the session expires, and grants full user scope,
which is exactly what we want to avoid.

**mTLS client certificates** — strong and elegant, but heavy operational machinery for a
personal prototype and awkward to revoke without a CRL/OCSP path.

**OAuth 2.0 device authorization grant** — the right long-term answer and better UX than
pasting a token. Deferred to task `213`; the token subject model is designed so that a device
grant can mint the same scoped token without changing the authorization path.
