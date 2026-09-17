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

Found by the security review of task `028`. Not introduced there — the schema is task `026`'s,
and `028`'s reachability code errs safe in the opposite direction (its survivor scan is
deliberately unscoped, so a foreign reference _keeps_ an object rather than reaping it).

`storage_objects_id_workspace_key` already exists, and task `026` added composite FKs elsewhere
for exactly this reason — see the reasoning behind `songs_current_version_belongs_to_song`. These
three references were missed:

- `asset_versions.storage_object_id` (`schema/versions.ts`)
- `derivatives.storage_object_id` (`schema/versions.ts`)
- `snapshots.storage_object_id` (`schema/snapshots.ts`)

Each is an FK to `storage_objects.id` alone. Nothing in the database prevents a cross-workspace
pointer today; only application code does.

## Scope

- Convert the three references to composite `(storage_object_id, workspace_id)` FKs against
  `storage_objects (id, workspace_id)`.
- A migration, expand/migrate/contract if any existing row violates the new constraint.
- A test per reference proving the cross-workspace insert is refused by the database.

## Non-scope

- Changing purge reachability, which task `028` settled.
- The other composite FKs, which task `026` already did.

## Dependencies

`028`

## Files expected to change

```
packages/db/src/schema/{versions,snapshots}.ts
packages/db/migrations/<next>_storage_object_tenancy.sql
packages/db/src/__tests__/schema.test.ts
```

## Implementation notes

- `ON DELETE` behaviour must not change: `asset_versions` and `snapshots` stay `RESTRICT`,
  `derivatives` stays `SET NULL` — and on a composite key that has to be written
  `ON DELETE SET NULL ("storage_object_id")`, naming the column. A bare `SET NULL` nulls **every**
  referencing column, which task `026` learned the hard way on `songs.current_version_id`.
- Check for violating rows before adding the constraint. There should be none, but "should be"
  is not a migration strategy.

## Security/privacy considerations

T1 (tenant isolation) with a T8 (data loss) consequence. The point of a composite FK here is that
it removes a class of bug rather than one instance: a future query that forgets a workspace
filter can no longer create a cross-tenant pointer for a later purge to act on.

## Acceptance criteria

- [ ] All three references are composite FKs against `(id, workspace_id)`.
- [ ] `ON DELETE` behaviour is unchanged, with `SET NULL` naming its column.
- [ ] A test per reference proves the database refuses a cross-workspace pointer.
- [ ] The migration checks for violating rows rather than assuming there are none.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db migrate:dry
pnpm --filter @youandfriends/db test
pnpm release-check
```

## Manual QA

1. Attempt a cross-workspace `asset_versions` insert by hand and confirm Postgres refuses it.

## Rollback/compatibility

Additive constraints. Reverting restores the gap described above.

## Status

`pending`

## Commit

_(not yet)_
