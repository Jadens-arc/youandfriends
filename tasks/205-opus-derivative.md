# 205 — Opus streaming derivative for capable clients

**Phase:** Media enhancements · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add an Opus derivative alongside AAC, served to clients that dependably support it, per ADR 0004's deferred path.

## User value

Smaller files and better quality per bit for listeners on browsers that support it.

## Scope

- Opus-in-WebM derivative generation alongside AAC.
- Client capability detection selecting the best supported format.
- Storage as an additional `derivatives` row — additive by design (task `026`).
- Backfill of existing versions.
- Cost and quality comparison recorded in ADR 0004.

## Non-scope

- Removing AAC — it remains the compatibility baseline.
- HLS (task `206`).
- Per-user format preference.

## Dependencies

`062`, `102`

## Files expected to change

```
packages/media/src/derivative.ts
apps/jobs/src/media.ts
apps/web/lib/player/format-selection.ts
docs/adr/0004-aac-streaming-derivative.md
```

## Implementation notes

- Task `102` re-verified Safari's Opus support and recorded the finding in ADR 0004. Start by reading that finding rather than re-litigating the decision.
- The `derivatives` table already supports multiple rows per version (task `026`), so this is genuinely additive.
- Capability detection must be conservative. Falling back to AAC costs bandwidth; serving Opus to a client that cannot play it costs the user their listening session.
- Backfill is a batch job over existing versions and should be resumable and rate-limited.
- Update ADR 0004 with the outcome — it is the record of why we chose what we chose.

## Security/privacy considerations

No new authorization surface. Opus derivatives are served under the same private keys and short-TTL presigned URLs as AAC.

## Acceptance criteria

- [ ] Opus derivatives are generated alongside AAC.
- [ ] Client capability detection is conservative and correct.
- [ ] Additional derivatives are stored without schema change.
- [ ] Existing versions are backfilled by a resumable, rate-limited job.
- [ ] AAC remains available as the fallback.
- [ ] ADR 0004 is updated with the outcome.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
pnpm --filter web test
```

## Manual QA

1. Play in Safari and confirm AAC; play in Chrome and confirm Opus.
2. Compare file sizes and listening quality.
3. Run the backfill and confirm resumability.

## Rollback/compatibility

Additive and regenerable. Reverting deletes Opus derivatives; AAC playback is unaffected.

## Status

`pending`

## Commit

_(not yet)_
