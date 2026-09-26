# 093 — Voice notes

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Let collaborators record voice notes in the browser or on mobile, upload them privately, and play them back with a compact waveform.

## User value

Humming the part instead of trying to describe it in words.

## Scope

- In-browser recording via MediaRecorder with an explicit, clear permission prompt.
- A configurable duration limit with a visible countdown.
- Direct private upload through the standard upload path (task `053`).
- Storage as an asset of kind `voice_note`, referenced by a comment.
- Compact waveform and duration on playback.
- An accessible fallback: voice notes are not transcribed, so the UI must make their presence and duration clear to non-listening users.
- Recording states: idle, recording, processing, uploading, failed, each distinct.

## Non-scope

- Transcription or speech-to-text.
- Voice note editing or trimming.
- Realtime voice chat.

## Dependencies

`090`, `053`, `063`

## Files expected to change

```
apps/web/components/comments/voice-note/**
apps/web/lib/audio/recorder.ts
apps/web/components/comments/__tests__/voice-note.test.tsx
```

## Implementation notes

- The microphone permission prompt must be explicit and explained beforehand. A browser permission dialog appearing with no context is the fastest way to get a permanent denial.
- MediaRecorder output format varies by browser — Safari produces MP4/AAC, Chrome WebM/Opus. Accept both and let the media pipeline normalize. Do not assume one.
- A duration limit is required. Without it, a forgotten open recording produces a very large upload.
- Always stop the media stream tracks when recording ends. A live microphone indicator that stays on after recording is alarming and is a genuine privacy failure.
- Voice notes go through the same upload path and the same media pipeline, producing a waveform (task `063`) — no second mechanism.
- Since we do not transcribe, the accessible presentation must at minimum convey author, duration, and that a voice note exists.

## Security/privacy considerations

Microphone access is a significant privacy boundary. The permission prompt is explained in advance; tracks are stopped immediately on completion; no recording occurs without an explicit user action. Voice notes are private audio stored and served exactly like music — private keys, short-TTL presigned URLs after authorization (T3). Recording requires commenter role.

## Acceptance criteria

- [x] Recording works in the browser and on mobile with an explained permission prompt. ("Record a voice note" opens an explanation first — the browser will ask, nothing records until you start, the microphone turns off when you stop, the limit, who can hear it — and the microphone is requested only from "Start recording". Refused: "The microphone was not allowed…", with how to allow it. No MediaRecorder: "This browser can't record audio here." Proven with a scripted microphone; real browsers and phones are manual QA.)
- [x] A configurable duration limit is enforced with a visible countdown. (`limitMs`, default 3:00. Elapsed and remaining in mono tabular figures; a polite one-time "30 seconds of recording left"; at the limit the recording stops, the microphone is released, and what was recorded is posted rather than lost.)
- [x] Both Safari and Chrome output formats are accepted and processed. (Opus in WebM preferred, AAC in MP4 next, otherwise the browser's default. The sniffer now recognizes WebM (EBML) and `audio/webm` is servable. `packages/media` synthesizes a Chrome WebM/Opus and a Safari MP4/AAC mono 48 kHz recording with ffmpeg, then sniffs, validates, transcodes, draws peaks, and measures loudness for each.)
- [x] Media stream tracks are stopped immediately when recording ends, proven by test. (Every track, on stop — before the recorder even delivers its last chunk — on cancel, on cancel while the permission prompt is up, at the limit, on a recorder error, when the recorder cannot be made, and on unmount. Mutation-checked: removing the `track.stop()` fails six tests.)
- [x] Voice notes upload through the standard path and get a waveform. (Create the `voice_note` asset → the standard multipart upload (`053`) → `POST /api/assets/:id/versions`, which enqueues the same media job as music. `operationsFor('voice_note')` is music's operations, pinned by test.)
- [x] Playback shows a compact waveform and duration. (48 bars from the voice note's own peaks, progress shown as it plays; duration in mono tabular figures. The stream URL is fetched on the first press, after authorization, and never stored. The song pauses while a voice note plays.)
- [x] Recording states are distinct and legible. (Explaining, asking for the microphone, recording, preparing, uploading, and denied / failed / unsupported / upload failed — each in words, with a status or alert role. A failed upload keeps the recording to try again and says it was not posted.)
- [x] Presence, author, and duration are conveyed accessibly. ("Voice note by Sam, 0:12" names each one before anyone plays it; "being prepared for playback" / "couldn't be prepared" in words; a voice-only thread is named "Thread: a voice note by Sam", and shows "(voice note)" on the waveform markers.)
- [x] Recording requires commenter role. (Making the asset needs `comment` on the song. Only its maker may open an upload into it, record that upload as its version, or attach it — each re-checked with `comment` at that moment. One recording per voice note, 25 MB ceiling, never on two comments. Viewers are offered no recorder, but can listen.)

**Found while testing, fixed here.**

- _The recording was never recorded._ The first draft uploaded the bytes but never made them the asset's version, and version recording demanded `edit`, so a commenter could not have done it anyway. Every voice note would have stayed "no recording yet" and could never be posted. The DB tests had hidden this by inserting the version directly. Recording a version is now kind-aware: for a voice note, its maker, with `comment`. The fixture now goes through create → upload → complete → record, as the browser does.
- _A voice note made its song unpurgeable._ The purge fixture, given a comment that carries a voice note, failed: the composite `comments → assets` FK was checked between the two cascades of one purge. It is now `DEFERRABLE INITIALLY DEFERRED` (the `0004` precedent). A purge that removes both passes. Purging a recording that a live comment still carries is refused at commit, and a test proves it.
- _A voice note was reachable as a file._ The generic rename, re-tag, and trash paths would have accepted one. Trashing a recording a live comment still carries would then have failed the whole purge run at commit. They now refuse it, 404-shaped. File search omits voice notes, which also keeps someone else's unposted recording out of results.

**Listening.** `view` on the song, the song live, the voice note carried by a live comment of that song, and its derivative complete. Otherwise the answer is 404-shaped, or "not ready" while processing. Deleting a comment detaches its voice note (a tombstone cannot keep one — a check) and trashes it.

**Coverage note.** In version recording, the check that only the maker may record cannot fail on its own. Only the maker can open a session, and recording already refuses anyone else's session. It stays as defense in depth, and no test isolates it.

**Not verified here.** Manual QA 1–3 need real Safari and Chrome, real microphones, and a phone: format acceptance on real devices, the indicator going out, and the limit (task `120`/`121`). The Opus and AAC fixtures are synthesized by ffmpeg to match what those browsers produce. They are not captures from the browsers themselves.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/media test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Record a voice note in Safari and in Chrome; confirm both upload and play.
2. Confirm the microphone indicator turns off immediately after recording.
3. Hit the duration limit and confirm graceful handling.

## Rollback/compatibility

Additive. Reverting loses voice notes; existing recordings remain as assets.

## Status

`complete`

## Commit

`046a2e7`
