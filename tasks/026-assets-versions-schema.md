# 026 — Assets, immutable versions, and storage objects schema

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Define the file layer: logical assets, immutable versions, storage object records, derivatives, the mix version stack with its current pointer, and folder snapshot manifests.

## User value

Every upload becomes a permanent, retrievable version. Nothing overwrites anything. The version stack under a song is the song's history.

## Scope

- `assets`: logical file with kind, name, tags, and placement within the single Project Files area.
- `asset_versions`: immutable, one storage object each, with uploader, note, and created time.
- `storage_objects`: bucket, opaque key, size, checksum, content type.
- `derivatives`: streaming audio, waveform peaks, thumbnails — regenerable, multiple rows per version permitted.
- `mix_versions` ordered per song, with `songs.current_version_id` as the current pointer.
- `snapshots` and `snapshot_entries`: relative path, size, mtime, checksum, ignored flag; immutable once finalized.
- Audio metadata columns: duration, codec, channels, sample rate, bit depth, integrated loudness, true peak, processing status.

## Non-scope

- Upload session tables (task `051`).
- Media job tables (task `064`).
- The Project Files UI (task `057`).

## Dependencies

`021`, `025`

## Files expected to change

```
packages/db/src/schema/{assets,versions,storage_objects,derivatives,snapshots}.ts
packages/db/migrations/**
packages/db/src/__tests__/versions.test.ts
```

## Implementation notes

- Immutability of `asset_versions` must be enforced, not just intended — reject updates to byte-identifying columns at the database level. 'Originals are sacred' is a schema property, not a code convention.
- The `derivatives` table permits several rows per version so an Opus derivative (deferred `205`) or HLS variants (deferred `206`) are additive, not a migration.
- One **Project Files** area only, per the design's confirmed amendment. Organization is folders and tags on `assets` — there is no Logic or MPC column, and none is to be added.
- `songs.current_version_id` gets its FK constraint here, completing the forward reference left in task `021`.
- Snapshot entries need a normalized relative path with traversal rejected at write time, not just at upload time (THREAT_MODEL T4).

## Security/privacy considerations

Immutable originals are the control against data loss and tampering (T8). Snapshot relative paths are untrusted input and are a path-traversal vector (T4) — normalize and reject at the schema boundary. Checksums enable the storage reconciliation in `docs/OPERATIONS.md` §5.

## Acceptance criteria

- [ ] Assets, versions, storage objects, derivatives, mix versions, and snapshots exist with correct relations.
- [ ] `asset_versions` byte-identifying columns are immutable, enforced at the database level.
- [ ] A song's current version pointer is maintained and always references a version of that song.
- [ ] Multiple derivatives per version are supported.
- [ ] There is exactly one Project Files area; organization is folders plus tags.
- [ ] Snapshot relative paths reject traversal, absolute paths, and escaping segments.
- [ ] Every table is workspace-scoped with a leading index, and registered in the task `023` IDOR suite.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db migrate:dry
```

## Manual QA

1. Insert a version, attempt to mutate its checksum, confirm rejection.
2. Create three mix versions and confirm the current pointer follows the newest.
3. Attempt a snapshot entry with `../` in its path and confirm rejection.

## Rollback/compatibility

Additive migration. Central to phases 5–7; reverting breaks them.

## Status

`pending`

## Commit

_(not yet)_
