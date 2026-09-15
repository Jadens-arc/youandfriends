# 213 — OAuth device authorization for the sync agent

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Replace token pasting with an OAuth 2.0 device authorization grant, per ADR 0005's deferred path.

## User value

Pairing a Mac by clicking approve in the browser instead of copying a token.

## Scope

- Device authorization grant: device code, user code, verification URI, polling.
- A browser approval surface showing what the device will be permitted to do.
- Minting the same scoped sync token on approval — no new authorization model.
- Agent implementation replacing the paste flow.
- Backward compatibility for existing pasted tokens.

## Non-scope

- Replacing the scoped token model — the grant mints the same token (ADR 0005).
- Device flow for other clients.
- Removing token pasting as a fallback.

## Dependencies

`110`, `116`

## Files expected to change

```
apps/web/app/api/oauth/device/**
apps/web/app/devices/approve/**
apps/sync-mac/src-tauri/src/auth/**
docs/adr/0005-mac-sync-authentication.md
```

## Implementation notes

- ADR 0005 designed the token subject specifically so a device grant could mint the same token without changing the authorization path. Honor that — do not introduce a parallel model.
- The approval screen must state plainly what the device will be able to do: append to one Project Files destination, nothing else. Vague consent screens train people to click through.
- Device codes are short-lived and rate-limited; user codes are short and human-readable but must still be unguessable within their lifetime.
- Keep paste working for existing pairings; migration should be optional, not forced.
- Update ADR 0005 to reflect the implemented flow.

## Security/privacy considerations

The device grant is an authorization path and must be rate-limited, with short-lived codes and explicit scoped consent. It mints the same Argon2id-hashed scoped token (T7), so the storage and revocation model is unchanged.

## Acceptance criteria

- [ ] The device authorization grant works end to end.
- [ ] The approval screen states the exact scope plainly.
- [ ] Approval mints the same scoped token through the existing model.
- [ ] Device and user codes are short-lived, rate-limited, and unguessable within their lifetime.
- [ ] Existing pasted tokens continue to work.
- [ ] ADR 0005 is updated.

## Tests and validation commands

```bash
pnpm --filter web test
cargo test --manifest-path apps/sync-mac/src-tauri/Cargo.toml
```

## Manual QA

1. Pair a device through the browser approval flow.
2. Confirm an existing pasted token still works.
3. Let a device code expire and confirm clean failure.

## Rollback/compatibility

Additive. Reverting returns to token pasting; existing pairings are unaffected.

## Status

`pending`

## Commit

_(not yet)_
