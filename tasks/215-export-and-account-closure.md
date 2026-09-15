# 215 — Data export, retention, and account closure

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Implement data export, the documented retention policy, and account closure — required by `docs/DESIGN.md` §13 before public launch.

## User value

Leaving with everything you put in, and knowing exactly what happens to it.

## Scope

- Full workspace export: originals, lyrics, metadata, comments, in an open documented format.
- Asynchronous export generation with a download link.
- A documented and implemented retention policy.
- Account closure with a grace period and clear consequences.
- Deletion of all user data on closure completion, verified.
- Published documentation of retention, deletion, export, and closure behavior.

## Non-scope

- Export in a competitor's proprietary format.
- Selective partial export — full export first.
- Automated migration to another service.

## Dependencies

`207`, `025`

## Files expected to change

```
apps/jobs/src/export.ts
apps/web/app/(workspace)/settings/data/**
docs/DATA_POLICY.md
```

## Implementation notes

- `docs/DESIGN.md` §13 requires documenting retention, deletion, export, and account-closure behavior **before public launch**. This task is a launch prerequisite, not an optional extra.
- Export must include originals, not just derivatives. Someone leaving takes their masters — anything less is holding their work hostage.
- Use open formats: original audio files as uploaded, lyrics as plain text and JSON, metadata and comments as JSON, with a documented manifest.
- A large export is a long job. Generate asynchronously, notify on completion, and expire the download link.
- Deletion on closure must be **verified**, including storage objects, not merely marked. An audit of what was deleted is appropriate here.
- Closure needs a grace period — an accidental or impulsive closure that immediately destroys masters is indefensible.

## Security/privacy considerations

Export bundles contain the workspace's most sensitive content in one downloadable file. The link must be short-lived, single-use, and authorized. Deletion on closure must be verified across the database and object storage, with the verification itself audited.

## Acceptance criteria

- [ ] Export includes originals, lyrics, metadata, and comments in documented open formats.
- [ ] Export generates asynchronously with a short-lived, single-use, authorized download link.
- [ ] The retention policy is documented and implemented.
- [ ] Account closure has a grace period with clear consequences.
- [ ] Deletion on closure is verified across database and object storage, and audited.
- [ ] `docs/DATA_POLICY.md` publishes retention, deletion, export, and closure behavior.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/jobs test
pnpm --filter web test
```

## Manual QA

1. Export a seeded workspace and confirm the bundle is complete and openable.
2. Close a test account and verify all data is removed from database and storage.
3. Confirm the export link expires and is single-use.

## Rollback/compatibility

**Launch prerequisite.** Legal review of the published data policy is required before public launch.

## Status

`pending`

## Commit

_(not yet)_
