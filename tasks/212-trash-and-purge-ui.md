# 212 — Trash and recovery interface

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Build the user-facing Trash: browsing deleted items, restoring them, and permanently purging with appropriate confirmation.

## User value

Getting back something deleted last week, and clearing out what is genuinely finished with.

## Scope

- A Trash destination listing soft-deleted items with deletion time and remaining recovery window.
- Restoration with the symmetric cascade from task `025`.
- Explicit permanent purge with strong confirmation.
- Filtering by type and date.
- Clear indication of when items will be automatically purged.
- Owner-only permanent purge.

## Non-scope

- Automatic purge scheduling (task `025`'s job).
- Cross-workspace recovery.
- Version-level recovery within a song — versions are immutable and are not deleted individually.

## Dependencies

`025`

## Files expected to change

```
apps/web/app/(workspace)/trash/**
packages/db/src/queries/trash.ts
```

## Implementation notes

- Restoration uses the symmetric cascade from task `025`. Restoring a project must restore exactly the songs that were deleted with it — the round-trip test already exists.
- Permanent purge needs friction proportional to its consequence: typed confirmation naming the item, not a single click. This is the only path in the product that destroys user music.
- Show the remaining recovery window clearly. 'Deleted 3 days ago, purges in 27 days' is far more useful than a date.
- Purge is owner-only even where deletion was not.

## Security/privacy considerations

Permanent purge is irreversible destruction of user music. It is owner-only, requires strong typed confirmation, and is audited (T8). The purge path must reuse task `025`'s referential checks rather than deleting directly.

## Acceptance criteria

- [ ] Trash lists soft-deleted items with deletion time and remaining window.
- [ ] Restoration uses the symmetric cascade and returns exactly what was deleted.
- [ ] Permanent purge requires typed confirmation naming the item.
- [ ] Purge is owner-only and audited.
- [ ] Purge reuses the referential checks from task `025`.
- [ ] Filtering by type and date works.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Delete a project, restore it from Trash, confirm all songs return.
2. Attempt purge as a non-owner and confirm refusal.
3. Purge an item and confirm the audit record.

## Rollback/compatibility

Additive UI over task `025`. Reverting hides Trash; soft deletion continues.

## Status

`pending`

## Commit

_(not yet)_
