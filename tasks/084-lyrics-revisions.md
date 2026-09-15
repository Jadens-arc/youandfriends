# 084 — Revision snapshots and restoration

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Store automatic and user-named lyric revisions, let users browse and compare them, and restore any revision without losing current work.

## User value

Getting back the verse you wrote last Tuesday and then talked yourself out of.

## Scope

- Automatic revision snapshots on a cadence and at lifecycle events.
- User-named checkpoints created explicitly.
- A revision list with timestamp, author, and name.
- Diff view comparing a revision against current.
- Restoration that creates a new revision rather than discarding current work.
- Retention policy keeping named checkpoints indefinitely and thinning automatic ones over time.

## Non-scope

- Real-time collaborative undo — Yjs handles in-session undo (task `082`).
- Cross-song revision comparison.
- Branching or merging of lyric versions.

## Dependencies

`080`, `082`

## Files expected to change

```
packages/db/src/schema/lyrics.ts
apps/web/components/lyrics/revisions/**
apps/web/app/api/songs/[songId]/lyrics/revisions/**
apps/web/components/lyrics/__tests__/revisions.test.tsx
```

## Implementation notes

- Restoration must **never destroy current work**. Snapshot current, then restore — so restoring is itself undoable. This is the single most important behavior in the task.
- Automatic snapshots on a fixed timer produce noise. Snapshot on meaningful change (a threshold of edits) plus a time floor, so a long writing session yields useful checkpoints rather than hundreds.
- Named checkpoints are kept indefinitely; automatic ones thin with age (keep all from today, hourly for a week, daily beyond). Document the policy in the UI so users know what persists.
- The diff should be line-based and structure-aware — a character-level diff of a lyric sheet is unreadable.
- Restoration is audited and, in a collaborative session, must propagate to other connected editors rather than silently diverging.

## Security/privacy considerations

Revisions contain lyrics and carry the same sensitivity and authorization. Restoration is an editor action, authorized and audited (`docs/DESIGN.md` §13). Revision retention interacts with the deletion policy — a deleted song's revisions are soft-deleted with it (task `025`).

## Acceptance criteria

- [ ] Automatic snapshots occur on meaningful change with a time floor.
- [ ] Users can create named checkpoints.
- [ ] The revision list shows timestamp, author, and name.
- [ ] A structure-aware diff compares a revision against current.
- [ ] Restoration snapshots current work first, so restoring is undoable.
- [ ] Retention keeps named checkpoints and thins automatic ones per a documented policy.
- [ ] Restoration is authorized, audited, and propagates to connected collaborators.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Write, checkpoint, rewrite, restore the checkpoint, confirm the rewrite is still recoverable.
2. Restore while a collaborator is connected and confirm they see the restoration.
3. Review the revision list after a long session and confirm it is useful rather than noisy.

## Rollback/compatibility

Additive. Reverting loses revision history — do not revert once users rely on it.

## Status

`pending`

## Commit

_(not yet)_
