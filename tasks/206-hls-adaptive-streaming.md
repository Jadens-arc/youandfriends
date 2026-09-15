# 206 — HLS adaptive streaming

**Phase:** Media enhancements · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add HLS with multiple bitrates for robust playback on variable mobile connections.

## User value

Listening on a weak connection without buffering, at whatever quality the connection supports.

## Scope

- HLS packaging at several bitrates.
- Playlist generation and segment storage.
- Player integration with native HLS on Safari and a library elsewhere.
- Fallback to progressive AAC where HLS is unavailable.
- Storage cost analysis before committing.

## Non-scope

- Live streaming.
- DRM.
- Replacing progressive playback, which remains the fallback.

## Dependencies

`205`

## Files expected to change

```
packages/media/src/hls.ts
apps/jobs/src/media.ts
apps/web/lib/player/hls.ts
```

## Implementation notes

- ADR 0004 deferred this deliberately: it multiplies job complexity, storage, and playback code for a private workspace with few listeners. Re-justify it against real usage before building it.
- Segmented storage multiplies object counts substantially, which affects Class A/B operation costs on R2 — do the cost analysis first (ADR 0001).
- Safari plays HLS natively; other browsers need a library. Two code paths, both needing test coverage.
- Signed URLs for segments are awkward — each segment needs authorization. Consider a signed playlist with a short-lived token rather than per-segment presigning.

## Security/privacy considerations

Segment-level authorization is the hard problem. A playlist referencing permanently accessible segments would violate T3. Design the token scheme before writing the packager.

## Acceptance criteria

- [ ] HLS is packaged at several bitrates with playlists and segments.
- [ ] Native HLS works on Safari; a library covers other browsers.
- [ ] Progressive AAC remains as fallback.
- [ ] Segment access is authorized without permanent URLs.
- [ ] Storage and operation cost analysis is recorded.
- [ ] Re-justification against real usage is documented.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
pnpm --filter web test
```

## Manual QA

1. Play on a throttled connection and confirm adaptation.
2. Confirm segments are not accessible without authorization.
3. Review the cost analysis.

## Rollback/compatibility

Additive and regenerable. Reverting removes HLS; progressive playback continues.

## Status

`pending`

## Commit

_(not yet)_
