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

- [x] Canonical document, plain text, and Yjs state are stored per song. (`lyrics_documents`: the validated Tiptap-shaped JSON (`packages/contracts/src/lyrics.ts`), `plain_text`, `yjs_state bytea` (written when the realtime layer sends it, task `082`), and a `version` counter; one row per song, a composite foreign key keeps it in the song's own workspace, and it goes with the song on purge.)
- [x] Autosave debounces on idle and fires on blur, page hide, and navigation. (`createAutosave`: 1.5 s idle debounce; `LyricsPanel` flushes on blur, `visibilitychange` → hidden and `pagehide` with a `keepalive` request, on unmount (navigating inside the app), and on `online`. Not `beforeunload`.)
- [x] The plain-text projection is regenerated from the canonical document on every save. (`lyricsPlainText` runs server-side on every save; the client never sends plain text. Tested: replaced words disappear from search.)
- [x] Save state is clearly indicated as saved, saving, offline, or conflict. (`SaveStateIndicator`, a `role="status"` line in words with an icon — also "Unsaved changes" and "You can no longer edit these lyrics". Offline keeps the edit in memory, retries every 15 s and on `online`, and never says "Saved". Nothing is written to `localStorage`.)
- [x] A stale-version save is detected as a conflict, never a silent overwrite. (The row is locked `FOR UPDATE` and the base version compared; 409. Two racing saves on one version produce one save and one conflict — tested. The panel offers "Load the newer version" and keeps the user's own text beside it.)
- [x] A GIN-indexed tsvector column supports search. (`search`, generated always as `to_tsvector('simple', plain_text)`, GIN-indexed; queried by task `045`.)
- [x] Every read and write is authorized; a revoked user's autosave is refused. (Read is `view`, write is `edit` through `packages/authz` on every save; a member demoted mid-session is refused 404-shaped — tested — and the panel then stops sending and says the change was not saved. `lyrics_documents` is in `SCOPED_TABLES` and its cross-workspace IDOR entry is live.)

**Also.** Autosave writes every few seconds, so the audit log records an editing session: a save by the same person within 15 minutes of their last is not a new `lyrics.updated` entry. The service measured that window against the database clock at first; the coalescing test caught it, and `updated_at` is now written from the service's clock.

**Interim editing surface.** Until the structured editor (task `081`) lands, the lyrics tab is a plain-text editor with bracketed section headings (`[Chorus]`) that round-trips losslessly to the section structure.

**Not verified here.** Manual QA 1–3 need a browser; none is available in this environment (task `120`).

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

`complete`

## Commit

_(not yet)_
