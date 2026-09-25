# 091 — Timestamped audio comments

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Let collaborators attach comments to a precise moment in the audio, mark them on the waveform, and jump between them.

## User value

Saying 'the snare at 1:42 is too loud' in a way that takes one click to hear.

## Scope

- Commenting from the current playhead in one action.
- Comment markers rendered on the waveform at their timestamps.
- Clicking a marker or a comment seeks the player to that moment.
- Marker clustering when comments are dense, so the waveform stays readable.
- Timestamps displayed in the monospace face with tabular figures.
- Keyboard navigation between timestamped comments.

## Non-scope

- Region comments spanning a time range — noted as a possible later enhancement.
- Comments anchored to a specific version rather than a song, deferred pending real usage.
- Realtime marker updates.

## Dependencies

`090`, `072`, `071`

## Files expected to change

```
apps/web/components/comments/timestamp/**
apps/web/components/player/waveform/comment-markers.tsx
apps/web/components/comments/__tests__/timestamp.test.tsx
```

## Implementation notes

- Commenting from the playhead must be one keystroke or one click — this is the highest-frequency interaction in mix review and friction kills it.
- Markers must not obscure the waveform. Render them in a dedicated lane below or above rather than on top of the audio shape.
- Cluster dense markers rather than overlapping them into an unreadable smear; expand a cluster on interaction.
- Markers need a keyboard path and accessible names including the timestamp and author — a canvas marker is invisible to assistive technology otherwise.
- Capture the playhead at the moment the comment is initiated, not at submit. The user keeps listening while typing, and submitting against the moved playhead anchors the comment in the wrong place.

## Security/privacy considerations

Same model as task `090`. Timestamps are not sensitive beyond the comment itself. Marker rendering must only show comments the viewer may read.

## Acceptance criteria

- [x] Commenting from the playhead takes one action. ("Comment at the playhead" under the waveform, or **C** anywhere on the song's page while not typing; listed with the player's shortcuts.)
- [x] Markers render on the waveform without obscuring the audio shape. (A lane of their own directly under the waveform — `components/player/waveform/comment-markers.tsx` — never drawn over it.)
- [x] Clicking a marker or comment seeks accurately. (If this song is loaded, any version: seek to the moment and play. If not: load the version the comment was made on, or the current one, at the moment. Same from a marker, a cluster entry, or the moment chip on a thread in the Comments tab.)
- [x] Dense markers cluster and expand on interaction. (Comments within 2.5% of the song's length of a cluster's first comment gather into one numbered marker that opens into a list; a cluster never spans more than that, so a long chain does not become one smear.)
- [x] Markers have keyboard navigation and accessible names including time and author. (Each marker is a button — "Comment at 1:42 by Sam: The snare is…"; clusters say "3 comments from 1:40 to 1:44" and report expanded; ← → Home End move between markers.)
- [x] The timestamp is captured at initiation, not at submit, proven by test. (The playhead moves on while typing; the anchor sent is the one taken at the press.)
- [x] Timestamps render in monospace with tabular figures.

**Anchoring.** A moment belongs to the song; the version records what was playing when it was written (it must be one of this song's versions — another song's, another workspace's, or an unknown one is refused 404-shaped). Markers show on every version.

**Not verified here.** Manual QA 1–3 need a browser, real audio, and a screen reader (task `120`/`121`).

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Comment at several points while listening; confirm each anchors where you expected.
2. Start a comment, let the track play on, submit, and confirm the anchor did not drift.
3. Navigate markers by keyboard with a screen reader.

## Rollback/compatibility

Additive over task `090`. Reverting loses timestamp anchoring; comments remain.

## Status

`complete`

## Commit

`e97aa35`
