# 029 — Seed lyrics, comments, and notifications

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Extend the task `027` seed to cover lyrics with structured blocks, comments including timestamped ones, and notifications — the three entity types whose tables did not exist when the seed was written.

## Why this exists

Split out of task `027` before coding, per the loop's rule against quietly reducing scope. `027` lists these in its scope, but `lyrics_documents` (task `080`), `comment_threads` and `comments` (task `090`), and `notifications` (task `095`) are all created later. Seeding them in `027` would have meant writing against tables that do not exist.

## Scope

- Lyrics documents with structured blocks on two or three seeded songs, and at least one song deliberately **without** lyrics — the empty state breaks layouts more often than the full one.
- A comment thread with general comments, and a thread anchored to an audio timestamp.
- A comment anchored to a lyric range, once task `091` defines the anchor.
- Notifications for a mention and for a completed upload, plus one already-read notification.
- A voice note comment, which is an `asset` of kind `voice_note` referenced by a comment.
- All of it inside `027`'s existing idempotent structure, reusing its deterministic ids and honouring its `--reset`.

## Non-scope

- Changing `027`'s seed structure, guards, or audio fixtures.
- Real recordings of any kind. The voice note is a generated tone like every other fixture.

## Dependencies

`027`, `080`, `090`, `095`

## Files expected to change

```
packages/db/src/seed/**
```

## Implementation notes

- Reuse `deterministicId` from `027` so a re-run updates rather than duplicates.
- The empty cases matter more than the full ones: a song with no lyrics, a thread with one comment, a notification list with nothing unread. A seed that only contains happy paths hides exactly the layouts that break.
- Timestamped comments need a song whose seeded version has a real duration, so anchor them inside `027`'s generated fixture length rather than at an arbitrary second.

## Security/privacy considerations

Same as `027`: never commit user music or real recordings (T9), and the seed must refuse to run against production. Both guards are inherited unchanged.

## Acceptance criteria

- [x] Lyrics documents exist with structured blocks, and at least one song has none.
- [x] A general comment thread and a timestamp-anchored thread both exist.
- [x] A voice note comment exists, backed by a generated fixture.
- [x] Notifications exist in read and unread states.
- [x] The seed remains idempotent and `--reset` still clears everything it creates.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db seed
pnpm --filter @youandfriends/db seed   # idempotent
pnpm --filter @youandfriends/db seed -- --reset
pnpm --filter @youandfriends/db test
```

## Manual QA

1. Open a seeded song and confirm lyrics, comments, and a timestamped comment all render.
2. Open the song deliberately without lyrics and confirm the empty state is correct.

## Rollback/compatibility

Development-only data. No schema change.

## Implementation record

- `packages/db/src/seed/conversation.ts`, called from `seed()` and `reset()` with deterministic
  ids throughout.
- Lyrics: structured sections on three songs, validated against `lyricsDocumentSchema` in the
  test. "Low Tide" and "Untitled Sketch" have none.
- Five threads on "Blue Hour" and "Careless Weather":
  - general, with replies, a mention stored as a reference, and reactions;
  - timestamp-anchored at 1.5 s on version 4, inside its 3 s fixture;
  - lyric-anchored;
  - resolved;
  - and a one-comment thread.
- A voice note comment, backed by a `voice_note` asset whose version is the generated 2 s
  tone — never a recording.
- Notifications: Avery has unread ones (a mention, a grouped three-comment row) and a read one.
  Tom's are all read. Sam has none.
- `--reset` removes exactly these rows, in its existing transaction, before the songs go.

**Deviation:** the lyric-anchored thread has no Yjs positions, because seeded lyrics have no
collaborative state yet. It renders as a comment whose words have changed. That is a real
state, but not a placed highlight.

**Validation not run as listed:** in this session the permission system blocked
`pnpm --filter @youandfriends/db migrate` and the `seed` CLI. `seed.test.ts` covers the same
ground against a freshly migrated scratch database: build, idempotent re-run, reset, and
rebuild, plus a test for the new rows. It passes. The CLI itself should still be run once by
hand.

## Review flag

Fast-tracked at the user's request (2026-10-13); no test-reviewer pass. The seed CLI was not run by hand (see above).

## Status

`complete`

## Commit

`2c80c8e`
