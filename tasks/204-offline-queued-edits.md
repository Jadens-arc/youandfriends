# 204 — Offline queued lyric edits and comments

**Phase:** Offline · **Iteration:** **deferred** (post-iteration-one)

## Objective

Queue lyric edits and comments made offline and synchronize them on reconnect, with conflict handling.

## User value

Writing a verse on the subway and having it arrive when you surface.

## Scope

- Local persistence of offline lyric edits and comments.
- A visible queue of pending changes.
- Synchronization on reconnect with Yjs merge for lyrics.
- Conflict surfacing for changes that cannot merge cleanly.
- Authorization re-check before applying queued changes.
- Clear online, syncing, and offline states (`docs/DESIGN.md` §10).

## Non-scope

- Offline uploads of large files.
- Offline permission or membership changes.
- Indefinite offline operation.

## Dependencies

`203`, `082`, `090`

## Files expected to change

```
apps/web/lib/offline/queue.ts
apps/web/lib/lyrics/offline.ts
apps/web/components/offline/**
```

## Implementation notes

- Yjs merges lyric edits well, which is why lyrics are feasible offline at all. Comments are simpler — they are appends.
- Re-check authorization before applying a queued change. A user who lost editor access while offline must not have their queued edits applied on reconnect.
- Cap the queue and its age. An unbounded queue of month-old edits applied suddenly is worse than dropping them with a clear explanation.
- Never silently drop a queued change. If it cannot be applied, surface it with its content so the user can recover the text.

## Security/privacy considerations

Queued changes carry lyric content on disk (asset priority 2) and must be scoped per user and cleared on sign-out, like task `203`'s cache. Authorization is re-checked at apply time, never at queue time.

## Acceptance criteria

- [ ] Offline lyric edits and comments persist locally, scoped per user.
- [ ] A visible queue shows pending changes.
- [ ] Reconnection synchronizes with Yjs merge for lyrics.
- [ ] Unmergeable conflicts are surfaced, never silently resolved.
- [ ] Authorization is re-checked before applying; revoked users' changes are refused with their content preserved for recovery.
- [ ] Queue size and age are capped with clear explanation.
- [ ] Online, syncing, and offline states are clear.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm test:e2e -- offline
```

## Manual QA

1. Edit lyrics offline, reconnect, confirm the merge.
2. Have a collaborator edit the same section meanwhile; confirm the merge or a surfaced conflict.
3. Lose editor access while offline; confirm queued edits are refused with content recoverable.

## Rollback/compatibility

Additive. Reverting loses offline editing; queued data must be flushed or exported first.

## Status

`pending`

## Commit

_(not yet)_
