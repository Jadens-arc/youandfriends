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
- **Found while implementing:** derivative objects were orphaned too, by the same mechanism and
  with no `RESTRICT` to catch it. See the note below.
- **Found in review, after a first commit:** the delete order regressed and mixes were missed.
  See "What the review caught".

## Non-scope

- The R2 `ObjectReaper` implementation (task `050`).
- Storage lifecycle rules in R2 (task `050`).
- A trash UI (deferred `212`).

## Dependencies

`026`

## Files expected to change

```
packages/db/src/{soft-delete,purge}.ts
packages/db/src/purge.test.ts
packages/db/src/__tests__/factories.ts        (makeSnapshot)
packages/db/src/index.ts                      (deleteAsset)
packages/db/src/schema/versions.ts            (the pointer comment)
packages/db/migrations/0005_file_lifecycle_audit.sql
packages/contracts/src/audit.ts
packages/authz/src/lifecycle.ts
packages/authz/src/__tests__/lifecycle.test.ts
docs/OPERATIONS.md                            (§4, which said storage was unreachable)
```

Wider than the task named, in two places, both recorded rather than slipped in:

- **`packages/contracts/src/audit.ts` and a migration.** The cascade now reaches assets and
  snapshots, and `packages/authz/src/lifecycle.ts` keeps one audit event per row touched — a
  stem that disappears inside somebody else's event is a row whose disappearance nobody can
  explain. `asset.deleted` already existed (claimed by task `025`, never emitted, because the
  planner it was written for could not reach an asset); `asset.restored`, `snapshot.deleted`,
  `snapshot.restored`, and the `snapshot` target type are new, and Postgres enums need a
  migration to carry them.
- **`deleteAsset`.** "An asset trashed on its own is purged once its own window passes" needs a
  way to trash one. There was none.

## Implementation notes

- The three false comments left behind were corrected in task `026` and now point here. Delete those pointers as part of this task rather than leaving them.
- Reuse the fixed-point refusal loop rather than adding a second mechanism — the bug it exists for is exactly the one that recurs here.
- `storage_objects` has no `deleted_at` by design: an object is not user-visible and has no independent recovery window. It is reaped when the last version referencing it goes, which means the plan must compute reachability rather than scan a column.
- **Derivatives own objects too, and `SET NULL` gives no safety net.** The task described the
  orphan for originals. Running a purge and counting rows showed the same hole one table over:
  a streaming rendition is a whole second file, `derivatives.asset_version_id` cascades, and
  `derivatives.storage_object_id` is `ON DELETE SET NULL` — so the row vanished and its bytes
  stayed in the bucket. Unlike `asset_versions` and `snapshots`, which are `RESTRICT` and
  therefore refuse a wrong answer loudly, a mistake here is silent in both directions: reaping
  an object a live derivative names would blank that pointer and leave a rendition that plays
  nothing. Both directions are now computed and both are tested.

## What the review caught

Three findings on the first commit (`a724f65`), all fixed here. Recorded rather than quietly
amended, because the first two were regressions I introduced and shipped.

1. **Every song with a mix became unpurgeable.** Deleting `assets` before `songs` meant the asset
   cascade reached `asset_versions` while `mix_versions.asset_version_id` — `ON DELETE RESTRICT`
   — still pointed at them. The result was `23503` and a rolled-back transaction, so one such row
   aborted the run for every tenant in it and nothing was ever purged. Every song the product
   produces has a mix; task `027`'s seed creates twelve. `planPurge` approved it with **zero
   refusals**, because nothing modelled `mix_versions`.

   No test caught it because no test in `purge.test.ts` used `makeMixVersion` — the fixture
   omitted the one row that makes the constraint bite. That is the same vacuous-fixture failure
   this repository has now hit three times. The shared fixture carries a mix now.

   The fix is three parts: the fixed point learned the mix relationship, `executePurge` clears
   the mixes of the songs in the run before touching assets, and — the case that is worse in kind
   — an asset whose version a **live** song still plays is now _refused_ with a readable reason
   rather than erroring. Removing that mix row would have deleted a row on a song that was never
   in the trash.

2. **A stale plan could destroy a surviving derivative's bytes, silently.** `executePurge`
   re-validated the rows but not the storage reachability, and handed the reaper
   `plan.storageKeys` rather than the keys it actually deleted. For `asset_versions` and
   `snapshots` `RESTRICT` refuses anyway; `derivatives` is `SET NULL` and has no net, so a
   restored song's rendition would have been deleted from the bucket with its row left claiming
   `complete` and nothing to re-queue it. The storage delete now re-validates all three
   references, and the reaper is handed what `returning()` reports.

3. **The CLI reported only three of five tables.** A run destroying two hundred assets printed
   `0 folders, 0 projects, 0 songs` — the entire human-readable product of the one command that
   destroys user work.

Also fixed: the purge audit loop wrote from `plan.candidates`, so a row restored between planning
and running got an event saying it was destroyed while it still existed; it writes from what
`executePurge` actually deleted now. The per-row `storageObjects` metadata was a run-wide count
attached to every event, which by this module's own standard is the wrong number, and is gone.

**Sent onward as task `007`:** the three foreign keys pointing at `storage_objects` reference
`id` alone rather than the composite `(id, workspace_id)` the rest of the schema uses. That is
task `026`'s schema, not this diff, and this task's reachability errs safe in the opposite
direction — but it is a real tenant-isolation gap and belongs in its own numbered task.

## Security/privacy considerations

This is the purge path — the only code that destroys user music (T8). Every rule from task `025` applies unchanged: plan before acting, refuse rather than guess, dry-run must never open a write transaction, and rows are destroyed before objects so a rollback leaves a recoverable record rather than an unfindable orphan.

## Acceptance criteria

- [x] Trashing a song trashes its assets and snapshots, in the same batch.
      Asserted from the rows, not the return value: a cascade that reported an id it never wrote
      would leave the asset live and downloadable.
- [x] Restoring that batch returns exactly those assets and snapshots, and no others.
      Including the case that matters — an asset trashed separately and earlier stays where its
      owner put it.
- [x] Purging a song reaps every storage object no surviving version references, proven by a
      test that counts `storage_objects` before and after — including a song with a mix, which
      is what every real song has and what the first commit could not purge at all.
- [x] A song is held back while an asset under it is still inside its recovery window.
      And the refusal travels upward through the existing fixed point rather than a second
      mechanism.
- [x] An asset trashed on its own is purged once its own window passes, and its song is not.
      An asset a **live** song still plays as a mix is held back instead, with a readable reason.
- [x] `planPurge` never returns `storageKeys: []` when a candidate owns an object.
- [x] The comments in `purge.ts`, `soft-delete.ts`, and `schema/versions.ts` that pointed at
      this task are gone — each replaced by what the code now does.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
pnpm release-check
```

## Manual QA

1. Upload-shaped fixture: song with two assets and three versions. Trash the song, confirm the
   assets disappear from a scoped read.
2. Restore, confirm exactly those assets return.
3. Run purge past the window with `--dry-run` and confirm the plan names the storage keys.

**Run against a local Postgres during implementation**, all four steps:

```
fixture: assets=2 objects=3
1. trashed the song -> assets marked: 2
   visible through scopedQuery: 0 (was 2)
2. restored -> assets returned: 2
   visible again: 2
3.   DESTROY assets  …  DESTROY assets  …  DESTROY songs  …
     3 to destroy, 0 held back, 3 storage objects.
4. storage objects: 3 before -> 0 after
   reaper received 3 keys; purged {"songs":1,"assets":2,"snapshots":0,…}
```

Before this change step 1 read `visible: 2` and step 4 read `3 before -> 3 after`.

**Verified by mutation**, fourteen of them, each failing by name: the planner returning no storage
keys; `deleteSong` not cascading to assets; dropping the survivor check; removing the song→asset
relationship from the fixed point; `restoreBatch` not restoring assets; `executePurge` not
deleting the storage rows; a purged asset audited as `song.deleted`; snapshots getting no audit
event; derivative objects left out of the plan; a surviving derivative no longer keeping its
object.

## Rollback/compatibility

**One schema change, additive:** `0005_file_lifecycle_audit.sql` adds enum values to
`audit_action` and `audit_target_type`. `ALTER TYPE ... ADD VALUE` cannot use a new value in the
transaction that adds it, which is fine here because nothing writes one until it has committed.

Postgres cannot remove an enum value, so this migration is not reversible in place — rolling it
back means recreating the type. That is the usual cost of an enum and the reason to add values
rarely; nothing depends on the new values except code shipped in the same commit, so a revert of
the code alone is safe and leaves three unused labels behind.

Reverting the rest restores the orphaning described above — do not revert.

## Status

`in-progress`

## Commit

_(not yet)_
