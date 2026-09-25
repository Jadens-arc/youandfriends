# 076 — Media Session and background playback

**Phase:** Persistent player · **Iteration:** one

## Objective

Integrate the Media Session API so lock-screen and system controls show correct metadata and work, and background playback behaves on iOS.

## User value

Controlling playback from the lock screen or AirPods, with the right artwork and title showing.

## Scope

- Media Session metadata: title, artist, album (project), artwork.
- Action handlers: play, pause, previous, next, seek backward/forward, seek to.
- Position state so the system scrubber tracks accurately.
- Artwork at the sizes the platform expects.
- Background playback continuity when the tab is backgrounded or the screen locks.
- AirPlay through native controls — exposed, not custom-built (`docs/OPERATIONS.md` §9).

## Non-scope

- A custom AirPlay picker — the web platform does not offer reliable control (`docs/DESIGN.md` §5 says 'where supported').
- Web Push notifications (deferred `210`).
- Native app behaviors iOS does not give web apps.

## Dependencies

`070`, `073`

## Files expected to change

```
apps/web/lib/player/media-session.ts
apps/web/lib/player/__tests__/media-session.test.ts
docs/OPERATIONS.md
```

## Implementation notes

- Update `setPositionState` on seek and rate change, or the system scrubber drifts from reality and the lock-screen control feels broken.
- Artwork must be served at the sizes platforms request; a single large image may be ignored entirely.
- This is exactly why task `070` uses native `<audio>`. Media Session with a fully custom Web Audio graph is unreliable when backgrounded on iOS.
- Feature-detect every action handler. Not all are supported everywhere, and registering an unsupported one throws on some browsers.
- Be honest about AirPlay: we expose native controls and do not claim custom control. Record the limitation in `docs/OPERATIONS.md` §9 rather than implying a capability we do not have.

## Security/privacy considerations

Media Session exposes track metadata to the operating system, which may display it on a lock screen visible to others. This is inherent to the feature and is accepted; it is worth noting that unreleased song titles become visible on a locked phone.

## Acceptance criteria

- [x] Lock-screen and system controls show correct title, artist, project, and artwork. (`connectMediaSession` in `lib/player/media-session.ts`, connected by the one `AudioHost`. Tracks now carry `album` — the project's name, only where the listener can see the project — and it falls back to the version label for a song shared on its own.)
- [x] Play, pause, previous, next, and seek actions work from system controls. (play, pause, stop, previoustrack, nexttrack, seekbackward/seekforward — ten seconds when the system does not say — and seekto, each driving the same controller the player bar does.)
- [x] Position state keeps the system scrubber accurate, including after seek and rate change. (`setPositionState` with duration, position read from the element, and the playback rate, re-sent when any of them moves; tested after a system seek and a speed change.)
- [x] Artwork is provided at platform-expected sizes. (Every cover rendition — 128, 256, 512 — declared at its real size, from task `069`'s `srcSet`.)
- [x] Playback continues when the tab is backgrounded and when the screen locks. (By construction: one native `<audio>` element, nothing paused on visibility change, no Web Audio graph (ADR 0004). Verifying it on a locked iPhone is Manual QA 1, not run here.)
- [x] AirPlay works through native controls; no custom picker is claimed. (`x-webkit-airplay="allow"` on the element; `docs/OPERATIONS.md` §9 says the system offers the route and we do not.)
- [x] Action handlers are feature-detected. (Each registration is attempted and a rejection swallowed; tested against a session that throws for three actions. "Next" is offered only when something is queued, and withdrawn otherwise.)

**Privacy, recorded.** An unreleased song's title and artwork appear on a locked phone's screen; `docs/OPERATIONS.md` §9 says so plainly.

**Not verified here.** Manual QA 1–3 need an iPhone and an AirPlay speaker.

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Play on an iPhone, lock the screen, confirm controls and artwork appear and work.
2. Seek from the lock screen and confirm the app follows.
3. AirPlay to a speaker through native controls.

## Rollback/compatibility

Additive. Reverting loses system integration; in-app playback remains.

## Status

`complete`

## Commit

`0e3e2dd`
