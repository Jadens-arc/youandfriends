# 214 — Native iOS application

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Build a native iOS app for the capabilities the web platform cannot deliver dependably.

## User value

Reliable background audio, dependable push, and proper offline storage on the device the product is most used on.

## Scope

- Native client covering the implemented flows.
- Reliable background audio and lock-screen integration.
- Native push notifications.
- Dependable offline storage without eviction surprises.
- Shared API contracts with the web app.
- App Store distribution.

## Non-scope

- Replacing the web app — it remains the primary surface.
- Android.
- Native-only features that would fragment the product.

## Dependencies

`210`, `203`

## Files expected to change

```
apps/ios/**
packages/contracts/**
```

## Implementation notes

- This is a substantial undertaking and an explicit iteration-one non-goal. Justify it against real usage before starting — the PWA may well be sufficient.
- The limitations documented in `docs/OPERATIONS.md` §9 are the actual case for this app. If those have stopped mattering in practice, this task should be closed rather than built.
- Share contracts via `packages/contracts` so the API cannot drift between clients.
- App Store review, signing, and distribution are real ongoing costs beyond the build.

## Security/privacy considerations

A native app adds a new client with its own credential storage (Keychain), certificate pinning considerations, and update path. The threat model needs a section for it before implementation begins.

## Acceptance criteria

- [ ] The native client covers the implemented flows.
- [ ] Background audio and lock-screen integration are reliable.
- [ ] Native push works.
- [ ] Offline storage is dependable.
- [ ] API contracts are shared with the web app.
- [ ] The threat model is extended to cover the native client.
- [ ] The decision to build is justified against real usage.

## Tests and validation commands

```bash
# Xcode build and test; not part of the Node pipeline
```

## Manual QA

1. Verify background audio reliability against the PWA.
2. Verify push delivery reliability.
3. Verify offline storage survives memory pressure.

## Rollback/compatibility

Separate application. Reverting removes it; the web app is unaffected.

## Status

`pending`

## Commit

_(not yet)_
