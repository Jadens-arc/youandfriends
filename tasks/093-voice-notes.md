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

- [ ] Recording works in the browser and on mobile with an explained permission prompt.
- [ ] A configurable duration limit is enforced with a visible countdown.
- [ ] Both Safari and Chrome output formats are accepted and processed.
- [ ] Media stream tracks are stopped immediately when recording ends, proven by test.
- [ ] Voice notes upload through the standard path and get a waveform.
- [ ] Playback shows a compact waveform and duration.
- [ ] Recording states are distinct and legible.
- [ ] Presence, author, and duration are conveyed accessibly.
- [ ] Recording requires commenter role.

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

`pending`

## Commit

_(not yet)_
