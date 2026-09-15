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
packages/db/src/schema/**
packages/db/src/soft-delete.ts
packages/authz/src/scoped-query.ts
packages/db/src/__tests__/soft-delete.test.ts
apps/jobs/src/purge.ts
```

## Implementation notes

- Default exclusion of deleted rows must live in `scopedQuery`, so forgetting to filter is impossible rather than merely discouraged.
- Cascade on delete, cascade on restore — and they must be **symmetric**, or restoring a project silently leaves songs deleted. Test the round trip.
- The purge job must refuse to delete a storage object with any live reference. Derivatives are regenerable and may be purged freely; originals never are while a version references them (THREAT_MODEL T8).
- Record `purge_after` at delete time rather than computing it at purge time, so changing the retention setting does not retroactively purge things users expect to still be recoverable.

## Security/privacy considerations

Soft deletion is the control against accidental and malicious data loss (T8). The purge job is the most dangerous code in the repository: it is the only path that destroys user music. It must be dry-runnable, must log every intended deletion before acting, and must never delete an original with a live reference.

## Acceptance criteria

- [ ] Every user-visible entity supports soft deletion with a recovery window.
- [ ] Soft-deleted rows are excluded by default via `scopedQuery`.
- [ ] Delete and restore cascades are symmetric, proven by a round-trip test.
- [ ] Purge runs only after the retention window and referential checks.
- [ ] Purge never deletes a storage object referenced by a live version.
- [ ] Purge supports `--dry-run` and logs intended deletions.
- [ ] Delete, restore, and purge are audited.

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

`pending`

## Commit

_(not yet)_
