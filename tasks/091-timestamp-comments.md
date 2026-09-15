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

- [ ] Commenting from the playhead takes one action.
- [ ] Markers render on the waveform without obscuring the audio shape.
- [ ] Clicking a marker or comment seeks accurately.
- [ ] Dense markers cluster and expand on interaction.
- [ ] Markers have keyboard navigation and accessible names including time and author.
- [ ] The timestamp is captured at initiation, not at submit, proven by test.
- [ ] Timestamps render in monospace with tabular figures.

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

`pending`

## Commit

_(not yet)_
