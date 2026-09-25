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

- [x] Automatic snapshots occur on meaningful change with a time floor. (Inside the save transaction: when the lyrics differ from the last revision by at least 4 lines or 80 characters of changed lines, at most once per 10 minutes — 2 minutes for a save made as the page is left. The first words ever saved are kept. `lib/lyrics/revisions-policy.ts`, tested pure and against the database.)
- [x] Users can create named checkpoints. (History → "Name a checkpoint"; the autosave is flushed first, so the checkpoint is of what is on screen. Editors only; audited `lyrics.checkpoint_created`.)
- [x] The revision list shows timestamp, author, and name. (Name — or its kind — the kind in words, a `<time>`, and who.)
- [x] A structure-aware diff compares a revision against current. (Line-based over the bracketed text: section headings stay headings; each row is marked added or removed with an icon, a tint, strikethrough for removals, and the word "Added"/"Removed" for screen readers.)
- [x] Restoration snapshots current work first, so restoring is undoable. (A `before_restore` revision of what is there is written in the same transaction before anything changes; restoring _it_ brings the work back — tested.)
- [x] Retention keeps named checkpoints and thins automatic ones per a documented policy. (Checkpoints and before-restore revisions are kept; automatic ones are all kept for a day, the latest per hour for a week, the latest per day after — applied at each automatic snapshot, and stated in the History panel.)
- [x] Restoration is authorized, audited, and propagates to connected collaborators. (`edit` on the song, 404-shaped otherwise; audited `lyrics.revision_restored` with both revision ids. The restore is computed as an edit of the stored Yjs state and returned as an update, which the restoring tab applies to its shared document — reaching everyone in the room; tested through the relay.)

**Schema.** `lyrics_revisions` (migration `0020`, with the composite same-workspace song reference, a check that checkpoints are named, and the `lyrics.checkpoint_created` audit value). Its cross-workspace IDOR entry is live. A trashed song's revisions are unreachable with it, and go with it when it is purged.

**Known limit.** A collaborator's words typed into a section in the instant that section is replaced by a restore go with that section; everything saved before the restore is in the `before_restore` revision.

**Not verified here.** Manual QA 1–3 need a browser and, for 2, a Liveblocks project (task `120`).

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

`complete`

## Commit

`3a7b93b`
