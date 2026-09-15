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
packages/db/src/schema/{users,workspaces,folders,projects,songs,favorites}.ts
packages/db/migrations/**
packages/db/src/__tests__/schema.test.ts
```

## Implementation notes

- The materialized `path` makes 'everything under this folder' a prefix query instead of a recursive CTE per request — it is the difference between fast and slow permission resolution in task `022`, which walks the ancestor chain on every check.
- Path maintenance on move must be transactional and must update the whole subtree. Write the test that moves a deep subtree before writing the code.
- Prevent folder cycles with a database-level constraint or trigger. Application-only checks lose races.
- Index `(workspace_id, ...)` leading on every composite index — every query is workspace-scoped, so the tenant column belongs first.
- `songs.current_version_id` is a nullable forward reference to a table that arrives in task `026`; add the FK constraint there rather than creating a circular migration now.

## Security/privacy considerations

This is where tenant isolation is structurally established. A tenant-owned table without `workspace_id` is a latent cross-tenant leak (THREAT_MODEL T1). A schema test must assert that every tenant-owned table has the column and an index leading with it.

## Acceptance criteria

- [ ] Every listed table exists with `workspace_id` where tenant-owned.
- [ ] Folder nesting supports arbitrary depth with a maintained materialized path.
- [ ] Moving a folder updates the entire subtree's paths transactionally.
- [ ] Folder cycles are impossible, enforced at the database level.
- [ ] A schema test asserts every tenant-owned table has `workspace_id` with a leading index.
- [ ] Migrations apply cleanly forward from empty and pass `migrate:dry`.

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

`pending`

## Commit

_(not yet)_
