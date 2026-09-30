# 110 — Sync token issuance and device management

**Phase:** macOS sync agent · **Iteration:** one

## Objective

Implement the server side of Mac agent authentication: scoped, revocable sync tokens per ADR 0005, with device registration and a management surface.

## User value

Connecting a Mac safely — a credential that can only do one thing, in one place, and can be revoked in a second.

## Scope

- `sync_devices` and `sync_tokens` schema: workspace, name, destination allow-list, Argon2id secret hash, expiry, `last_used_at`, revocation.
- Token generation in the `yaf_sync_<ULID>_<secret>` format, displayed exactly once.
- A sync-token subject type in `packages/authz`, resolving through the standard permission path.
- Scope enforcement: append-only to Project Files, within the destination allow-list, within one workspace.
- A device management UI: list, bound folder, last used, revoke.
- Audit events for issuance, use, and revocation.

## Non-scope

- The Tauri agent itself (tasks `111`–`118`).
- OAuth device flow (deferred `213`).
- Token auto-rotation.

## Dependencies

`032`, `023`, `024`

## Files expected to change

```
packages/db/src/schema/sync.ts
packages/authz/src/subjects.ts
apps/web/app/(workspace)/settings/devices/**
apps/web/app/api/sync/**
packages/authz/src/__tests__/sync-tokens.test.ts
```

## Implementation notes

- Per ADR 0005: store the ULID in cleartext for lookup and an **Argon2id hash** of the secret. Verify in constant time. Never store the full token.
- The sync-token subject must resolve through the same `resolveAccess` path as a member — it is a subject type, not an authorization bypass. That is what keeps the whole model coherent.
- Scope enforcement is server-side and absolute: a token cannot read lyrics, post comments, manage permissions, mint share links, or delete. Test every one of these negatives (task `023`).
- The `yaf_sync_` prefix exists so secret scanners can find a leaked token. Keep it.
- Revocation must take effect on the next request — no caching of token validity beyond a request.
- Display the token once and say so clearly. A token retrievable later is a token sitting in a database in a form we promised it would not be.

## Security/privacy considerations

This is the T7 control surface. Scoped, hashed, revocable, audited, prefixed for scanning. The negative tests are as important as the positive ones — a sync token that can read another workspace's songs would be a critical failure, and task `023` asserts it cannot.

## Acceptance criteria

- [x] Tokens are generated in the documented format and shown exactly once. (`yaf_sync_<ULID>_<secret>`, from `buildToken`: 256 random bits, 43 base64url characters. The pairing response carries it once, and the settings page holds it only in memory until "Done", saying it won't be shown again. Nothing can read it back.)
- [x] Secrets are hashed; the full token is never stored. (**scrypt, not Argon2id** — ADR 0005 is amended with why: ADR 0010's reasoning for a 256-bit random secret, and the native addon's build risk. A database check refuses any `secret_hash` not in the scrypt scheme. A test searches every token, grant, and audit row written and finds neither the token nor its secret.)
- [x] Verification is constant-time. (`verifySecret` compares with `timingSafeEqual`. An unknown token id is verified against a decoy hash, so it takes as long as a wrong secret, and every failure gives the same answer.)
- [x] The sync-token subject resolves through the standard `authz` path. (`createAuthorizer` resolves it, via `syncTokenAccess`, for every caller: the destination allow-list is `permission_grants` rows for the `sync_token` subject, and the services the agent uses take it through `assertCan` like anyone else.)
- [x] Tokens are append-only to Project Files within their destination allow-list and workspace. (A project with an exact grant, `edit` only, while the token, its device, and its pairer's own edit access all hold. Through the real services the Mac creates a snapshot, recorded as `mac_agent`, and opens its ZIP upload into its destination — and is refused for a sibling project and for a song's mix.)
- [x] Every negative case (lyrics, comments, permissions, deletion, other workspaces) is tested and refused.
  - **authz:** every action other than `edit`; every action on a song or folder, even with a grant planted there; a sibling project; another workspace, even with a grant pointing there; revoked, expired, and disconnected-device tokens; a pairer demoted or removed; and delete and restore.
  - **Services:** reading lyrics, starting a comment thread, trashing a file, pairing another device, and uploading to a song's mix.
  - Mutation-checked: each rule, removed, fails a test. The project-only rule first passed with nothing to refuse, and the fixture now plants grants on a song and a folder so it bites.
- [x] Revocation takes effect on the next request. (Validity is read from the database on every request, never remembered past one. Tests revoke, then authenticate: refused. Revoking a device revokes its tokens too.)
- [x] Issuance, use, and revocation are audited. (`sync_token.issued` by the pairer; `sync_token.used` with the token as actor, hourly while in use rather than per request; `sync_token.revoked` per token. Uploads the Mac makes are audited with the token as their actor. Metadata holds ids and counts, never the token.)
- [x] `last_used_at` is visible in device management. (Settings → Devices lists each device with its destinations, last use, expiry, and connected, expired or disconnected state, and a Disconnect action for its pairer or an owner.)

**API.** The Mac agent's endpoints are `/api/sync/agent/*`: `destinations`, `snapshots` and its `finalize`, and the upload protocol (`uploads`, `parts`, `complete`, `abort`). They are public to the session layer, each requiring `Authorization: Bearer <token>`, and a token is never read from a query string. Pairing and managing devices is `/api/sync/devices`, behind the session.

**Not verified here.** Manual QA 1–4 against a real Mac agent, which tasks `111`–`118` build. The agent's side of pairing and its Keychain storage belong to them.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter web test
pnpm --filter @youandfriends/db test
```

## Manual QA

1. Issue a token, confirm it is shown once and not retrievable afterwards.
2. Use it to upload to its destination; confirm success.
3. Attempt to read lyrics and to upload elsewhere; confirm both are refused.
4. Revoke and confirm the next request fails.

## Rollback/compatibility

Additive. Reverting after devices are paired breaks sync. Revoke tokens before reverting.

## Status

`complete`

## Commit

_(not yet)_
