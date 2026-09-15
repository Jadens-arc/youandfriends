# 080 — Lyrics schema, plain-text projection, and autosave

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Define lyrics storage — canonical document snapshot, searchable plain text, and Yjs state — with debounced autosave and clear save-state indication.

## User value

Writing lyrics somewhere they are actually safe, and finding them later by a line you remember.

## Scope

- `lyrics_documents`: canonical Tiptap JSON, plain-text projection, Yjs state vector, version counter.
- Debounced autosave on idle, on blur, and on lifecycle events (page hide, navigation).
- Plain-text projection maintained on every save, feeding search (task `045`).
- Save-state indication: saved, saving, offline, conflict.
- Conflict detection via the version counter.
- A generated `tsvector` column with a GIN index for search.

## Non-scope

- The editor itself (task `081`), realtime collaboration (task `082`), revisions (task `084`).
- Rich formatting beyond the structured blocks the design specifies.

## Dependencies

`026`, `042`

## Files expected to change

```
packages/db/src/schema/lyrics.ts
apps/web/app/api/songs/[songId]/lyrics/**
packages/contracts/src/lyrics.ts
packages/db/src/__tests__/lyrics.test.ts
```

## Implementation notes

- **Postgres is canonical, Liveblocks is transport** (ADR 0003). This task establishes the canonical store first, deliberately, so the realtime layer in task `082` is an enhancement rather than a dependency for not losing work.
- Save on page hide, not only on a debounce timer. A user who closes the tab mid-thought must not lose the last thirty seconds. Use `visibilitychange` and `pagehide`; `beforeunload` is unreliable on mobile Safari.
- The plain-text projection is derived, never authored — regenerate it from the canonical document on every save so it cannot drift.
- The version counter enables optimistic concurrency. A save against a stale version is a conflict, surfaced to the user, never a silent overwrite.
- Lyrics are among the most sensitive assets in the product (threat model asset 2). Authorization on every read and write, no exceptions.

## Security/privacy considerations

Lyrics rank second in the asset priority list. Every read and write runs through `assertCan`. The plain-text projection feeds search and inherits the same filtering (task `045`). Autosave must never write to a document the user has lost access to mid-session — the write re-checks authorization.

## Acceptance criteria

- [ ] Canonical document, plain text, and Yjs state are stored per song.
- [ ] Autosave debounces on idle and fires on blur, page hide, and navigation.
- [ ] The plain-text projection is regenerated from the canonical document on every save.
- [ ] Save state is clearly indicated as saved, saving, offline, or conflict.
- [ ] A stale-version save is detected as a conflict, never a silent overwrite.
- [ ] A GIN-indexed tsvector column supports search.
- [ ] Every read and write is authorized; a revoked user's autosave is refused.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Type lyrics, wait for autosave, reload, confirm content persists.
2. Close the tab mid-typing and confirm the last edit survived.
3. Edit the same document from two sessions and confirm a conflict is surfaced.

## Rollback/compatibility

Additive. Reverting loses lyrics persistence — do not revert once lyrics exist.

## Status

`pending`

## Commit

_(not yet)_
