# 028 — Purge reaches storage objects, and assets join the lifecycle

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Extend the task `025` delete/restore/purge machinery to the file layer task `026` added, so that trashing a song trashes its assets, restoring returns them, and purging destroys the storage objects instead of orphaning them.

## Why this exists

Found by the security and test reviews of task `026`, and verified against a live database. Task `025` was written when folders, projects, and songs were the only user-visible entities, and it left two comments promising that task `026` would revisit them. Task `026` created the tables and registered them for tenant-isolation testing — which satisfied the guard that existed, because that guard checks for a cross-tenant test, not for purge awareness. So the promise lapsed silently.

Two failures, both reproduced:

1. **Storage objects are orphaned forever.** `executePurge` hard-deletes a song; the cascade takes `assets` → `asset_versions` → `mix_versions` and leaves the `storage_objects` rows behind. `planPurge` still returns `storageKeys: []`, `storage_objects` has no `deleted_at` and is never scanned, so nothing ever reaps the keys. A user's master WAV stays in R2 indefinitely with no record of what it is — breaking both the retention promise and the reconciliation in `docs/OPERATIONS.md` §5. The guard in `purge.ts` that exists to prevent exactly this cannot fire, because the list it checks is empty.

2. **Assets bypass the recovery window in both directions.** `assets` and `snapshots` carry `softDeleteColumns()`, but `deleteSong` does not mark them, so trashing a song leaves its stems live and visible through `scopedQuery`, and restore is not symmetric. In the other direction `planPurge` never scans them, so an asset trashed on its own is never purged — and purging its song hard-deletes it even if it is still inside its own recovery window. That last one is failure mode #1 from task `025`, recurring in a place the fixed point does not reach.

## Scope

- `assets` and `snapshots` become purge candidate tables in `planPurge`.
- `deleteSong`, `deleteProject`, `deleteFolder` cascade to `assets` and `snapshots` with the same batch id; `restoreBatch` returns them; `CascadeResult` widens.
- `planPurge` collects `storage_objects.key` for every object reachable from a purge candidate, respecting the `ON DELETE RESTRICT` on `asset_versions.storage_object_id`.
- The referential fixed point learns the asset and snapshot relationships, so a song is held back while an asset under it is still inside its window.
- `storage_objects` rows are deleted with the versions that referenced them, in order: rows first, then the objects through the `ObjectReaper`.
- Audit events for the widened cascade.

## Non-scope

- The R2 `ObjectReaper` implementation (task `050`).
- Storage lifecycle rules in R2 (task `050`).
- A trash UI (deferred `212`).

## Dependencies

`026`

## Files expected to change

```
packages/db/src/{soft-delete,purge}.ts
packages/db/src/{purge.test.ts,__tests__/soft-delete.test.ts}
packages/authz/src/lifecycle.ts
packages/authz/src/__tests__/lifecycle.test.ts
```

## Implementation notes

- The three false comments left behind were corrected in task `026` and now point here. Delete those pointers as part of this task rather than leaving them.
- Reuse the fixed-point refusal loop rather than adding a second mechanism — the bug it exists for is exactly the one that recurs here.
- `storage_objects` has no `deleted_at` by design: an object is not user-visible and has no independent recovery window. It is reaped when the last version referencing it goes, which means the plan must compute reachability rather than scan a column.

## Security/privacy considerations

This is the purge path — the only code that destroys user music (T8). Every rule from task `025` applies unchanged: plan before acting, refuse rather than guess, dry-run must never open a write transaction, and rows are destroyed before objects so a rollback leaves a recoverable record rather than an unfindable orphan.

## Acceptance criteria

- [ ] Trashing a song trashes its assets and snapshots, in the same batch.
- [ ] Restoring that batch returns exactly those assets and snapshots, and no others.
- [ ] Purging a song reaps every storage object no surviving version references, proven by a test that counts `storage_objects` before and after.
- [ ] A song is held back while an asset under it is still inside its recovery window.
- [ ] An asset trashed on its own is purged once its own window passes.
- [ ] `planPurge` never returns `storageKeys: []` when a candidate owns an object.
- [ ] The comments in `purge.ts`, `soft-delete.ts`, and `schema/versions.ts` that point at this task are removed.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
pnpm release-check
```

## Manual QA

1. Upload-shaped fixture: song with two assets and three versions. Trash the song, confirm the assets disappear from a scoped read.
2. Restore, confirm exactly those assets return.
3. Run purge past the window with `--dry-run` and confirm the plan names the storage keys.

## Rollback/compatibility

No schema change. Reverting restores the orphaning described above — do not revert.

## Status

`pending`

## Commit

_(not yet)_
