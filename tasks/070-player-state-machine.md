# 070 — Player state machine and audio element

**Phase:** Persistent player · **Iteration:** one

## Objective

Build the global player state: a single audio element that survives route changes, an explicit state machine, and short-TTL stream URL management with transparent refresh.

## User value

Playback that never stops because you navigated somewhere. The foundation of 'listening never breaks'.

## Scope

- A single `<audio>` element owned by the shell, never remounted by routing (task `013`).
- An explicit state machine: idle, loading, ready, playing, paused, seeking, stalled, ended, error.
- Stream URL acquisition through an authorized endpoint returning a short-TTL presigned URL.
- Transparent URL refresh before expiry, preserving playhead and playing state.
- Global state via a store consumable anywhere, without prop drilling through the tree.
- Error recovery: network loss, expired URL, decode failure, each with a distinct path.

## Non-scope

- Player UI (task `071`), queue (task `073`), waveform (task `072`).
- Web Audio graph processing — native `<audio>` is deliberate (ADR 0004, `docs/OPERATIONS.md` §9).
- Gapless playback (task `073`, best-effort).

## Dependencies

`062`, `013`

## Files expected to change

```
apps/web/lib/player/{store,machine,stream-url,audio-element}.ts
apps/web/lib/player/__tests__/**
apps/web/app/api/stream/[versionId]/route.ts
```

## Implementation notes

- Native `<audio>` rather than a Web Audio graph. This is what gives us Media Session, lock-screen controls, AirPlay, and background playback on iOS, and a custom graph can be suspended when backgrounded (`docs/OPERATIONS.md` §9).
- Stream URLs expire (~15 minutes, task `050`). A track longer than the TTL, or a paused track resumed later, must refresh transparently — capture `currentTime` and `paused`, swap `src`, restore position. Users must never see a mid-song failure.
- One audio element, always. Multiple elements fight over Media Session and over iOS's single-audio-focus model.
- Model `stalled` distinctly from `loading`. They need different UI and different recovery.
- The state machine should be testable without a real audio element — drive it with a mockable adapter, but test the adapter against a real element too.

## Security/privacy considerations

Stream URLs are issued only after `assertCan(subject, 'stream', version)` and are short-TTL (T3). They are never logged and never persisted to storage that outlives their TTL. Each refresh re-checks authorization, so revoking access stops playback at the next refresh rather than never.

## Acceptance criteria

- [ ] A single audio element survives every route change.
- [ ] The state machine models all listed states explicitly.
- [ ] Stream URLs are authorized, short-TTL, and refreshed transparently before expiry.
- [ ] Playhead and playing state are preserved across a URL refresh.
- [ ] Authorization is re-checked on refresh; revoked access stops playback.
- [ ] Network loss, expired URL, and decode failure each have a distinct recovery path.
- [ ] Stream URLs never appear in logs or persistent client storage.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Play a track, navigate across several routes, confirm audio continues uninterrupted.
2. Shorten the TTL in config and confirm refresh is seamless mid-track.
3. Revoke access mid-playback and confirm playback stops at the next refresh.

## Rollback/compatibility

Central to phase 7. Reverting breaks all playback.

## Status

`pending`

## Commit

_(not yet)_
