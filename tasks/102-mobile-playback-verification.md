# 102 — Mobile playback verification and iOS limitations

**Phase:** Mobile and PWA · **Iteration:** one

## Objective

Verify playback on real iOS Safari across backgrounding, lock screen, AirPlay, interruptions, and network changes — and document precisely what the platform does not support.

## User value

Playback that behaves correctly on the device it will mostly be used on, with honest documentation where the web platform falls short.

## Scope

- Verification of the AAC derivative on iOS Safari across versions available for testing (ADR 0004).
- Background playback, lock-screen controls, and Media Session behavior on device.
- AirPlay through native controls.
- Interruption handling: phone calls, other audio apps, headphone disconnect.
- Network transition handling: Wi-Fi to cellular, connection loss mid-track.
- Re-verification of ADR 0004's Opus assumption, with the ADR updated to reflect findings.
- Documentation of every confirmed limitation in `docs/OPERATIONS.md` §9.

## Non-scope

- Implementing Opus support (deferred `205`) — this task re-verifies the assumption and records the answer.
- Offline playback (deferred `203`).
- Working around iOS limitations with unreliable hacks.

## Dependencies

`076`, `077`, `062`

## Files expected to change

```
docs/OPERATIONS.md
docs/adr/0004-aac-streaming-derivative.md
apps/web/lib/player/**
```

## Implementation notes

- ADR 0004 explicitly requires re-verifying Safari's Opus support **before this task**. Do it and record the result in the ADR, whichever way it goes. If Opus is now dependable, an additional derivative is cheap and additive; if not, the AAC decision is reconfirmed with evidence rather than inherited assumption.
- Test on a real device. iOS Safari's audio behavior — autoplay restrictions, backgrounding, interruptions — is not faithfully reproduced by desktop Safari or by emulation.
- Audio interruptions (a phone call) suspend playback. Handle resume gracefully rather than leaving the player in a wedged state.
- iOS requires a user gesture to start audio. Verify that every playback entry point originates from a genuine gesture, including queue auto-advance, which is the one that commonly breaks.
- Document limitations honestly (`docs/DESIGN.md` §10 forbids pretending the PWA can do what iOS cannot). This task's deliverable is partly documentation, and that documentation is as important as the code.

## Security/privacy considerations

No new authorization surface. Verify that stream URL refresh (task `070`) works correctly across network transitions and backgrounding — a refresh failure while backgrounded must not silently retry with a stale credential.

## Acceptance criteria

- [ ] Playback is verified on real iOS Safari, not emulation.
- [ ] Background playback and lock-screen controls work.
- [ ] AirPlay works through native controls.
- [ ] Interruptions suspend and resume gracefully.
- [ ] Network transitions and loss are handled, including stream URL refresh while backgrounded.
- [ ] Queue auto-advance works within iOS gesture restrictions.
- [ ] ADR 0004's Opus assumption is re-verified and the ADR updated with the finding.
- [ ] Every confirmed limitation is documented in `docs/OPERATIONS.md` §9.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
# Manual device verification is the substance of this task
```

## Manual QA

1. Play on a real iPhone; lock the screen; confirm audio and controls.
2. Receive a phone call mid-playback; confirm graceful suspend and resume.
3. Switch from Wi-Fi to cellular mid-track; confirm playback continues.
4. Let a long track cross the stream URL TTL while backgrounded.

## Rollback/compatibility

Verification and documentation. Any fixes are additive; reverting loses them and the recorded findings.

## Status

`pending`

## Commit

_(not yet)_
