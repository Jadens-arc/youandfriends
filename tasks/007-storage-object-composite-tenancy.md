# 007 — Make storage-object ownership a database fact

**Phase:** Foundation · **Iteration:** one

## Objective

Give the three foreign keys that point at `storage_objects` the composite `(id, workspace_id)`
form the rest of the schema uses, so "this object belongs to this workspace" is enforced by
Postgres rather than by every query remembering to check.

## User value

Indirect, and the blast radius is user music. A workspace-scoped purge is only as scoped as the
rows it reads; if an `asset_versions` row in workspace A can name workspace B's object, purging A
destroys B's bytes.

## Why this exists

**The premise this task was written on was wrong, and the correction is the task.**

The security review of task `028` reported that the three references to `storage_objects` were
foreign keys to `id` alone, leaving a cross-workspace pointer possible. It read
`packages/db/src/schema/versions.ts` and `snapshots.ts`, where the Drizzle column does say
`.references(() => storageObjects.id)`, and concluded from that.

It is not the whole picture. Migration `0004_file_layer.sql` adds a **second**, composite
constraint per reference — `asset_versions_object_same_workspace`,
`snapshots_object_same_workspace`, `derivatives_object_same_workspace` — each pairing the
reference with `workspace_id` against the `(id, workspace_id)` unique key, and the derivative's
written as `ON DELETE SET NULL ("storage_object_id")`, naming the column, exactly as this task
supposed still needed doing. Task `026` closed the class. Reproduced against a real Postgres:
all three cross-workspace inserts are refused, by name.

**What was genuinely missing was the proof.** Nothing tested any of the three. A guarantee that
nothing exercises is one that can stop working without a red signal — the failure this
repository has now hit three times over, and the reason `CLAUDE.md` §13 carries the fixture
rule. That gap is what this task closes.

The stake, so the tests read as the tenant-isolation tests they are: a row in workspace A naming
B's object reads as A's through a scoped handle, so a download endpoint resolves it, presigns
B's key, and hands A someone else's music (T1). And a workspace-scoped purge of A would destroy
B's bytes on the way past (T8).

## Scope

- A test per reference proving the database refuses a cross-workspace pointer, plus one proving
  it still allows the same reference within a workspace — a constraint that refused everything
  would pass the first three and break the product.

**No migration and no schema change.** The constraints exist. Writing a migration to add them
again would be churn against a false premise, and `ALTER TABLE ... ADD CONSTRAINT` on a
constraint that is already there is an error, not a no-op.

## Non-scope

- Changing purge reachability, which task `028` settled.
- The other composite FKs, which task `026` already did.

## Dependencies

`028`

## Files expected to change

```
packages/db/src/__tests__/schema.test.ts
```

Narrower than planned: the schema and the migration both turned out to be correct already.

## Implementation notes

- **Read the migration, not only the Drizzle schema.** A Drizzle `.references()` emits one
  constraint; a migration can add another beside it, and the composite tenancy pairings are
  added that way throughout this repository. Judging the database from the TypeScript alone is
  what produced this task's false premise, and it is a mistake worth not repeating — the schema
  file is a description, the migration is the database.

## Security/privacy considerations

T1 (tenant isolation) with a T8 (data loss) consequence. The point of a composite FK here is that
it removes a class of bug rather than one instance: a future query that forgets a workspace
filter can no longer create a cross-tenant pointer for a later purge to act on.

## Acceptance criteria

- [x] All three references are composite FKs against `(id, workspace_id)`.
      Already true, by task `026`. Verified against a real Postgres rather than read off the
      Drizzle schema, which is what produced the false finding in the first place.
- [x] `ON DELETE` behaviour is unchanged, with `SET NULL` naming its column.
      `asset_versions` and `snapshots` are `RESTRICT`; `derivatives` is
      `ON DELETE SET NULL ("storage_object_id")`. A bare `SET NULL` on a composite key nulls
      every referencing column, including `workspace_id` — the mistake task `026` made once on
      `songs.current_version_id` and did not repeat here.
- [x] A test per reference proves the database refuses a cross-workspace pointer.
      Three, plus the positive case. Verified by dropping each constraint's tenancy pairing in
      turn: each one fails its own test by name.
- [x] The migration checks for violating rows rather than assuming there are none.
      Not applicable — there is no migration, for the reason under Scope.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db migrate:dry
pnpm --filter @youandfriends/db test
pnpm release-check
```

## Manual QA

1. Attempt a cross-workspace `asset_versions` insert by hand and confirm Postgres refuses it.

**Run against a real Postgres**, all three references:

```
ERROR: insert or update on table "asset_versions" violates foreign key constraint
       "asset_versions_object_same_workspace"
ERROR: insert or update on table "snapshots" violates foreign key constraint
       "snapshots_object_same_workspace"
ERROR: insert or update on table "derivatives" violates foreign key constraint
       "derivatives_object_same_workspace"
```

## Rollback/compatibility

Tests only. Reverting removes the proof, not the protection.

## Status

`complete`

## Commit

`adaed5d`
