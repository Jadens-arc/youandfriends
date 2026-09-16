# 021 — Core schema: identity, tenancy, and content hierarchy

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Define the tables for users and Clerk identity mapping, workspaces and memberships, nestable folders, projects, and songs — with every tenant-owned row workspace-scoped.

## User value

Nested folders containing projects containing songs, exactly as the library is meant to be organized.

## Scope

- `users` with the Clerk `user_id` mapping; `workspaces`; `workspace_memberships`.
- `folders` with safe nesting: parent reference plus a materialized `path` for subtree queries.
- `projects` (name, artist, cover art asset reference, status, folder placement).
- `songs` (title, project, duration, status, current mix version pointer).
- `favorites`.
- `workspace_id` on every tenant-owned row, indexed as the leading column of composite indexes.
- Cycle prevention on folder nesting, enforced in the database, not only in application code.

## Non-scope

- Assets, versions, snapshots (task `026`).
- Lyrics, comments, notifications (their phases).
- Permission grants (task `022`).
- Soft deletion columns (task `025`).

## Dependencies

`020`

## Files expected to change

```
packages/db/src/schema/{columns,users,workspaces,folders,projects,songs,favorites,index}.ts
packages/db/src/schema/tables.test.ts
packages/db/migrations/0000_core_schema.sql
packages/db/src/__tests__/{schema,folders}.test.ts
packages/db/src/__tests__/factories.ts
packages/contracts/src/work-status.ts
```

`columns.ts` holds the shapes every table shares, so tenancy and identity cannot be spelled
two ways. `work-status.ts` is in `contracts` because the database, the API, and the UI must
read one vocabulary; a hand-copied list in the schema would drift and surface as a constraint
violation in production.

## Implementation notes

- The materialized `path` makes 'everything under this folder' a prefix query instead of a recursive CTE per request — it is the difference between fast and slow permission resolution in task `022`, which walks the ancestor chain on every check.
- Path maintenance on move must be transactional and must update the whole subtree. Write the test that moves a deep subtree before writing the code.
- Prevent folder cycles with a database-level constraint or trigger. Application-only checks lose races.
- Index `(workspace_id, ...)` leading on every composite index — every query is workspace-scoped, so the tenant column belongs first.
- `songs.current_version_id` is a nullable forward reference to a table that arrives in task `026`; add the FK constraint there rather than creating a circular migration now.

## Security/privacy considerations

This is where tenant isolation is structurally established. A tenant-owned table without `workspace_id` is a latent cross-tenant leak (THREAT_MODEL T1). A schema test must assert that every tenant-owned table has the column and an index leading with it.

## Acceptance criteria

- [x] Every listed table exists with `workspace_id` where tenant-owned.
- [x] Folder nesting supports arbitrary depth with a maintained materialized path, computed by
      the database rather than supplied by the caller — a test inserts a deliberate lie into
      `path` and asserts it is overwritten.
- [x] Moving a folder updates the entire subtree's paths transactionally. Proven at five
      levels deep, including that a failure mid-transaction leaves the whole subtree in place.
- [x] Folder cycles are impossible, enforced at the database level: self-parent, parent under
      its own child, and parent under a distant descendant all raise `check_violation`.
- [x] A schema test asserts every tenant-owned table has `workspace_id` with a leading index —
      twice, from both directions. See below.
- [x] Migrations apply cleanly forward from empty and pass `migrate:dry`.

## Verification

```
Test Files  10 passed (10)
     Tests  103 passed (103)
Statements : 100% · Lines : 100% · Functions : 96.87%

release-check: 8 gates, all pass (migration dry run included)
```

**The tenancy check runs from both ends.** `schema.test.ts` reads the _live migrated
database_ — `information_schema` for the column, `pg_index` for the leading index — so it sees
what Postgres actually did, including anything a hand-written migration created that the
TypeScript schema does not know about. `tables.test.ts` checks the same invariants against the
declarations via `getTableConfig`, which fails earlier and in a more useful place: a bad index
definition is caught before a migration is generated from it. A third test keeps the
exemption list honest by asserting no exempt table has quietly gained a `workspace_id`.

**Verified on Neon's Postgres 17, not only locally.** The triggers, the generated `depth`
column, `text_pattern_ops`, and `hashtextextended` were exercised on a throwaway Neon branch:
a three-level subtree moved and followed its parent correctly, and a cycle was rejected with
the expected message. The branch was deleted afterwards. `main` still has zero tables — the
schema lands there on first deploy, through `migrate`, so drizzle's ledger stays honest.

## Decisions taken

- **Triggers, not application code, own the folder invariants.** `path` is _computed_ from the
  parent rather than accepted from the caller, so it cannot be set wrong; a path disagreeing
  with `parent_id` would make every subtree query — and therefore permission resolution in
  task `022` — return the wrong rows, silently. The cascade runs inside the caller's
  transaction, so a subtree is never half-moved.
- **A workspace-scoped advisory lock during a move.** The cycle check alone loses a race: two
  transactions moving A under B and B under A each see a pre-move tree, each pass, and commit
  a cycle neither could have created alone. `pg_advisory_xact_lock` on the workspace
  serialises moves, which are rare.
- **`depth` is a stored generated column.** One fewer column that can disagree with another.
- **A shared `WORK_STATUS` vocabulary for projects and songs.** `docs/DESIGN.md` §2 says each
  carries a status but does not fix the values. Two overlapping vocabularies would be a
  product decision made by inference; one shared list is the smaller, reversible default, and
  adding a project-only value later is additive.
- **Favourites are polymorphic, and that costs a foreign key.** Three nullable columns with
  three real foreign keys would enforce referential integrity, at the price of a CHECK
  asserting exactly one is set and every read branching on which. A dangling favourite is a
  row the UI skips; task `025`'s soft deletion sweeps them.
- **Deleting a folder does not delete the work in it** (`on delete set null` on
  `projects.folder_id`). Originals are sacred, and so is anything pointing at them.
- **Root-level folder names need their own partial index.** Postgres treats NULLs as distinct
  in a unique index, so `(workspace_id, parent_id, name)` permits unlimited identical root
  folders. Both partial indexes are tested.

## A test that was asserting nothing

`migrate.test.ts`, written in task `020`, ran its fixture migrations against the shared test
harness — which now applies the real migration first. Drizzle's ledger then held entry `0000`,
so each fixture's own `0000` was skipped as already applied and the assertions passed against
an empty result. It only surfaced because this task added the first real migration. Those
tests now run against unmigrated scratch databases, and the reason is recorded where the
helper is defined.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/db migrate:dry
```

## Manual QA

1. Create a five-level folder tree, move a mid-level folder, confirm all descendant paths update.
2. Attempt to make a folder its own ancestor; confirm the database rejects it.

## Rollback/compatibility

Additive migration from empty. Later changes to these tables follow the expand/migrate/contract procedure in `docs/OPERATIONS.md` §4.

## Status

`complete`

## Commit

_(not yet)_
