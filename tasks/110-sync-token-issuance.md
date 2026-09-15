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

- [ ] Tokens are generated in the documented format and shown exactly once.
- [ ] Secrets are Argon2id-hashed; the full token is never stored.
- [ ] Verification is constant-time.
- [ ] The sync-token subject resolves through the standard `authz` path.
- [ ] Tokens are append-only to Project Files within their destination allow-list and workspace.
- [ ] Every negative case (lyrics, comments, permissions, deletion, other workspaces) is tested and refused.
- [ ] Revocation takes effect on the next request.
- [ ] Issuance, use, and revocation are audited.
- [ ] `last_used_at` is visible in device management.

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

`pending`

## Commit

_(not yet)_
