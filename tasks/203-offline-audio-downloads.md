# 203 — Offline audio downloads in the PWA

**Phase:** Offline · **Iteration:** **deferred** (post-iteration-one)

## Objective

Let authorized users explicitly download streaming copies for offline listening, with clear state and honest handling of iOS storage eviction.

## User value

Listening to the current mixes on a plane, or anywhere without signal.

## Scope

- Explicit per-song download and remove controls.
- Cache Storage management with a visible size budget.
- Clear state: downloaded, downloading, failed, evicted.
- Offline playback from cached copies.
- Re-authorization on reconnect, removing content the user no longer may access.
- Graceful handling of Safari's storage eviction.

## Non-scope

- Offline lyric and comment editing (task `204`).
- Downloading originals rather than derivatives.
- Background download.

## Dependencies

`100`, `070`

## Files expected to change

```
apps/web/app/sw.ts
apps/web/lib/offline/**
apps/web/components/player/download-controls.tsx
```

## Implementation notes

- Task `100` deliberately did not cache authorized content because caching it needs an authorization story. That story is this task's substance.
- Cached audio on a shared device is a data-leak risk. Scope the cache per user and clear it on sign-out — this is the hard requirement, not the download UI.
- Re-authorize on reconnect and evict content the user has lost access to. A cached mix that outlives the collaborator's access is a genuine leak.
- Safari evicts under storage pressure. Show real state and re-download gracefully; never assume a cached file is still there (`docs/OPERATIONS.md` §9).
- Downloads are derivatives, not originals — originals are large and are a separate, permission-gated action.

## Security/privacy considerations

Cached authorized media is the highest-risk part of offline support. Cache is scoped per user, cleared on sign-out, and re-validated on reconnect. Content the user no longer may access is evicted. This must be tested on a shared-device scenario before shipping.

## Acceptance criteria

- [ ] Explicit download and remove controls work per song.
- [ ] Cache is scoped per user and cleared on sign-out, proven by test.
- [ ] Downloaded, downloading, failed, and evicted states are visible and accurate.
- [ ] Offline playback works from cached copies.
- [ ] Reconnection re-authorizes and evicts content the user may no longer access.
- [ ] Safari eviction is handled gracefully with honest state.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm test:e2e -- offline
```

## Manual QA

1. Download songs, enable airplane mode, confirm playback.
2. Sign out and confirm the cache is cleared.
3. Revoke access to a downloaded song, reconnect, confirm eviction.

## Rollback/compatibility

Additive. Reverting removes offline playback; cached data must be cleared as part of the revert.

## Status

`pending`

## Commit

_(not yet)_
