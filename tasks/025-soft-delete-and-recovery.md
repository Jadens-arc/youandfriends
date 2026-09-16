# 025 — Soft deletion and recovery window

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Add soft-deletion and a recovery window to every user-visible entity, with restoration, and purge jobs that run only after referential and retention checks.

## User value

Deleting something by accident is survivable. Trash is a real place with real contents, not a euphemism for gone.

## Scope

- `deleted_at`, `deleted_by`, `purge_after` on every user-visible entity.
- Default query scoping that excludes soft-deleted rows unless explicitly requested.
- Cascade semantics: deleting a project marks its songs deleted, with restoration restoring the same set — recorded precisely, because ad hoc cascade is where data loss hides.
- Restoration that returns an entity to its prior parent, or to a sensible place if the parent is gone.
- A purge job that deletes only after the retention window **and** referential checks, never deleting a storage object still referenced by a live version.
- Audit events for delete, restore, and purge.

## Non-scope

- The Trash UI (deferred `212`).
- Storage object lifecycle rules in R2 (task `050`).
- Legal retention policy (a product decision, not an engineering one).

## Dependencies

`024`

## Files expected to change

```
packages/db/src/schema/{soft-delete,folders,projects,songs}.ts
packages/db/src/{soft-delete,purge}.ts
packages/db/bin/purge.mjs
packages/db/migrations/0003_soft_delete.sql
packages/db/src/{purge.test.ts,__tests__/soft-delete.test.ts}
packages/authz/src/{scoped-query,lifecycle}.ts
packages/authz/src/__tests__/lifecycle.test.ts
docs/OPERATIONS.md §4c
```

**Not `apps/jobs/src/purge.ts`.** That directory is created by task `064`, which wires
Trigger.dev; standing it up half-built now would leave `064` reconciling two setups. The purge
lives in `packages/db` next to the schema it operates on, with a CLI beside the migration
commands, and `064` schedules it. Storage deletion is an injected `ObjectReaper` port rather
than an import, because `packages/db` must not depend on `packages/storage`
(`docs/ARCHITECTURE.md` §3) — and because a dry run then cannot delete an object even in
principle.

## Implementation notes

- Default exclusion of deleted rows must live in `scopedQuery`, so forgetting to filter is impossible rather than merely discouraged.
- Cascade on delete, cascade on restore — and they must be **symmetric**, or restoring a project silently leaves songs deleted. Test the round trip.
- The purge job must refuse to delete a storage object with any live reference. Derivatives are regenerable and may be purged freely; originals never are while a version references them (THREAT_MODEL T8).
- Record `purge_after` at delete time rather than computing it at purge time, so changing the retention setting does not retroactively purge things users expect to still be recoverable.

## Security/privacy considerations

Soft deletion is the control against accidental and malicious data loss (T8). The purge job is the most dangerous code in the repository: it is the only path that destroys user music. It must be dry-runnable, must log every intended deletion before acting, and must never delete an original with a live reference.

## Acceptance criteria

- [x] Folders, projects, and songs support soft deletion with a recovery window. Assets and
      versions arrive in task `026`; `packages/authz`'s resource registry fails the build when
      those tables appear, so they cannot ship without this.
- [x] Soft-deleted rows are excluded by default via `scopedQuery` — not a flag the caller has
      to remember. Asking for `deleted` or `all` is an explicit, visible decision.
- [x] Delete and restore are symmetric, proven by a round-trip test — and by the harder case:
      restoring a project does **not** resurrect a song its owner trashed separately first.
- [x] Purge runs only after the retention window **and** referential checks, with the window
      read from the value recorded at delete time.
- [x] Purge never deletes a storage object with a live reference. Storage is not wired until
      task `050`, so a plan naming objects with no reaper supplied **refuses** rather than
      deleting rows and orphaning them.
- [x] `--dry-run` produces the plan and destroys nothing — by taking a path that never opens a
      write transaction, not by checking a flag before each delete.
- [x] Delete, restore, and purge are audited per row.

## Verification

```
@youandfriends/db     155 tests   99.2%  statements
@youandfriends/authz  500 tests   99.45% statements
release-check: 10 gates, all pass
```

## Two data-loss bugs, found by running the job rather than reading it

Both were silent, both destroyed recoverable work, and neither was caught by the unit tests —
which had always deleted whole trees at once, where neither case can arise. They surfaced the
first time the CLI ran against seeded rows with mixed delete ages.

**1. A cascade the referential check did not anticipate.** The check refused a project with a
_live_ song. But `songs.project_id` is `ON DELETE CASCADE`, so purging a project hard-deletes
every song still pointing at it — including one trashed yesterday, still inside its recovery
window, that the plan never named. A row the owner could still have restored, destroyed
through a foreign key, with nothing in the output to say so.

**2. The refusal did not travel upwards.** Fixing (1) held the project back — and the purge
destroyed its folder anyway, because the folder's own check saw the project in the candidate
list and counted it as going too. `projects.folder_id` is `ON DELETE SET NULL`, so the held-back
project silently became unfiled. Refusals are now resolved to a fixed point, so refusing a
child refuses every ancestor above it.

After the fix, the same scenario:

```
  DESTROY songs    HRQKWJ…   DESTROY songs    TB7R2P…

  Held back:
    KEEP    projects NKNYDM…  — song QPZP49… is in the trash and not yet purgeable
    KEEP    folders  MJ99Y6…  — project NKNYDM… is in the trash and not yet purgeable

Purged 0 folders, 0 projects, 2 songs.
```

Three regression tests cover both, including a three-level tree where one song inside its
window keeps its project, its folder, and its grandparent folder alive.

## Decisions taken

- **`deleted_batch` is what makes restore exact.** Deleting a project cascades to its songs,
  but some may have been trashed individually days earlier. Restoring must bring back the
  songs _this delete_ took and leave the others where their owner put them. Re-deriving the
  cascade at restore time cannot tell them apart.
- **`purge_after` is recorded at delete time**, not computed at purge time. Otherwise lowering
  the retention setting retroactively destroys work a user was told was recoverable — a
  promise broken by a configuration change.
- **A project whose folder is still deleted restores unfiled; a song whose project is still
  deleted blocks.** Unfiled is a state the product already has. A song has nowhere honest to
  go, and restoring its project silently would be a bigger action than the one asked for, so
  it raises a typed `RestoreBlockedError` a caller can turn into a sentence.
- **Storage objects are deleted after the rows, inside the same transaction.** If it rolls
  back afterwards, the objects are gone but the rows still say what was lost — recoverable.
  The other order destroys the record of what to look for.
- **Planning is read-only.** `--dry-run` is trustworthy because `planPurge` cannot write, not
  because the caller remembered to stop.
- **A per-run limit and a workspace filter.** A purge that takes two nights is fine; one that
  empties everything because a query was wrong is not.
- **Partial indexes on `deleted_at is null`.** The default query is "live rows in this
  workspace", and tombstones accumulate for the whole retention window.

## Scope note

Soft deletion applies to folders, projects, and songs — the user-visible entities that exist.
Favourites, memberships, and grants are not trashed: unfavouriting, removing a member, and
revoking access are not deletions with a recovery window, and giving them tombstones would
make "in the trash" mean two different things.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/jobs test
```

## Manual QA

1. Delete a project, confirm its songs disappear from the library and appear in trash.
2. Restore it and confirm exactly the same songs return.
3. Run purge with `--dry-run` against fixtures and review the intended deletions.

## Rollback/compatibility

Additive columns. Reverting after real deletions would resurrect or strand rows — do not revert once in use.

## Status

`complete`

## Commit

_(not yet)_
