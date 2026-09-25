# 075 — A/B version switching

**Phase:** Persistent player · **Iteration:** one

## Objective

Switch between mix versions at the same playhead with the same playing state, fast enough to be useful for comparison.

## User value

The core mix-review move: hearing the same bar in yesterday's mix and today's, back to back, without losing your place.

## Scope

- Switch to any version of the current song, preserving `currentTime` and playing state exactly.
- Preloading of the alternate version so the switch is fast rather than a fresh buffer.
- Keyboard shortcut for switching between the two most recent, and for cycling versions.
- Clear indication of which version is currently sounding.
- Loudness values visible during comparison (task `061`), since level difference dominates perceived quality.
- Graceful handling of versions with different durations.

## Non-scope

- Loudness-matched comparison — we measure and display, we do not normalize (ADR 0004).
- Simultaneous multi-version playback.
- Automatic difference analysis.

## Dependencies

`070`, `056`, `061`

## Files expected to change

```
apps/web/lib/player/ab-switch.ts
apps/web/components/song/versions/ab-controls.tsx
apps/web/lib/player/__tests__/ab-switch.test.ts
```

## Implementation notes

- Preload the alternate version into a second audio element kept in sync. Switching `src` on one element and seeking costs a visible buffer, which destroys the comparison.
- Position preservation must be exact. Switching to a slightly different offset makes comparison useless — assert this in a test with tolerance in milliseconds, not seconds.
- Versions may differ in duration. If the current position exceeds the other version's length, clamp to its end and say so rather than failing.
- Show loudness during comparison. Without it, users will conclude the louder mix is the better mix — that is human hearing, not the mix.
- Preloading a second version needs its own authorization check and stream URL (task `070`).

## Security/privacy considerations

Each version's stream URL is separately authorized and short-TTL (T3). Preloading does not bypass the check — the second element gets its own authorized URL.

## Acceptance criteria

- [x] Switching preserves `currentTime` within a few milliseconds, proven by test. (`switchVersion` reads the playhead from the element at the moment of the switch — not the store's last `timeupdate` — and starts the other version there; tested to under a millisecond: 83.4567 s in, 83.4567 s out.)
- [x] Playing state is preserved across the switch. (Playing stays playing, paused stays paused; the loop region and the queue position carry over, and a switch does not count as a new play.)
- [x] The alternate version is preloaded so the switch is fast. (When the comparison is offered, the alternate's URL is fetched and its bytes warmed **at the current position** in the detached, never-played element; at the switch the prepared URL is used without a request, and the next alternate is prepared for the flip back.)
- [x] Keyboard shortcuts switch and cycle versions. (A flips to the last other version heard; V steps through the versions. Both only where a comparison is offered, and never from fields.)
- [x] The sounding version is unmistakable. (The comparison is a radio group, "Sounding version": the one playing is checked, carries a speaker icon and the word "Sounding", and the player bar's version word changes with it.)
- [x] Loudness is visible during comparison. (Integrated loudness and true peak on every option, from task `061`'s analysis.)
- [x] Versions of different durations are handled by clamping with a clear indication. (Past a shorter version's end, the switch lands at its end and says "Version 1 is shorter — playing from its end.")
- [x] Each version's stream URL is separately authorized. (Each version's URL comes from its own call to `/api/stream/:versionId`, which authorizes it — tested that the alternate is requested for itself before any switch.)

**Deviation: one playing element, not two.** The task's notes suggest a second element kept in sync. Task `070` requires exactly one playing element — two fight over Media Session and iOS's single audio focus — so the alternate is prepared (URL authorized, bytes warmed where playback is) in a detached element that never plays, and the one element switches source at the exact instant. A switch may still cost a moment of buffering in a real browser; how fast it _feels_ (Manual QA 1–2) is task `120`'s to confirm.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Play a mix, switch to the previous version mid-phrase, confirm you land in the same place.
2. Switch repeatedly and confirm it stays fast.
3. Compare versions of different lengths near the end of the longer one.

## Rollback/compatibility

Additive. Reverting loses A/B; version playback remains.

## Status

`complete`

## Commit

`41af46e`
