# 045 — Command palette and search

**Phase:** Library navigation · **Iteration:** one

## Objective

Provide an always-available command palette combining navigation, actions, and search across projects, songs, lyrics text, and file names.

## User value

Getting anywhere, or doing anything, without hunting — including finding a song by a lyric you half-remember.

## Scope

- Command palette opening by keyboard shortcut and by click from the shell.
- Search across project names, song titles, file names, and lyrics plain text.
- Postgres full-text search over the lyrics plain-text projection from task `080`.
- Actions in the palette: create project, upload, go to settings, toggle playback.
- Recent and suggested entries when the query is empty.
- Debounced querying with a visible loading state and a real empty state.

## Non-scope

- Fuzzy ranking beyond Postgres full-text capabilities.
- Search across workspaces.
- Saved searches or filters.

## Dependencies

`041`, `080`

## Files expected to change

```
apps/web/components/command/**
apps/web/app/api/search/route.ts
packages/db/src/queries/search.ts
packages/db/migrations/** (search indexes)
```

## Implementation notes

- Every search query must be workspace-scoped **and** authorization-filtered. Search is the most direct route to an IDOR leak in the whole product: an unfiltered `ILIKE` across songs returns other people's titles.
- Use Postgres `tsvector` with a generated column and a GIN index over the lyrics plain-text projection, rather than `ILIKE` scans.
- Filter in the query, not after fetching. Fetching then filtering leaks through result counts and timing.
- Debounce input and cancel superseded requests, or fast typing produces a queue of stale responses that flicker.
- Lyrics are among the most sensitive assets in the product (threat model asset 2) — searching them demands the same authorization rigour as playing audio.

## Security/privacy considerations

Search is a top IDOR risk (T1). Filtering happens in the query through `scopedQuery`. Task `023`'s suite includes a search-specific negative test: a collaborator searching a term that appears only in an inaccessible song must get zero results, and must not be able to infer existence from response timing or counts.

## Acceptance criteria

- [x] The palette opens by keyboard shortcut and by click. (⌘K / Ctrl+K and the shell's Search button open `CommandPalette`; the mobile Search destination renders the same body as a page.)
- [x] Search covers project names, song titles, file names, and lyrics text. (`GET /api/search?q=` → `lib/search/service.ts` → `searchWorkspace` in `packages/db/src/queries/search.ts`. Names, titles, and file names by escaped `ILIKE`; each hit links to its project, song, or the song's Lyrics or Files tab.)
- [x] Lyrics search uses a GIN-indexed tsvector, not a scan. (`lyrics_documents.search @@ to_tsquery('simple', …)` over the column and index task `080` added — no new migration was needed. Prefix matching, so words match while still being typed; `ts_headline` snippets with the matched words marked, rendered as text.)
- [x] Results are authorization-filtered in the query. (Visible project and song ids are resolved first from ids and scope chains only, by the library's resolver; every clause of the search — and the join that names a hit's project — is bounded by them in SQL. Nothing is fetched and then hidden.)
- [x] A collaborator cannot find content they lack access to, proven by test. (`apps/web/lib/search/__tests__/service.test.ts`: a one-song collaborator and a member denied one project get nothing for words that exist only in the hidden project — no hits in any group, so no count — and a song shared on its own does not name its project. Widening the visible set, or unbounding the project-name join, fails these tests.)
- [x] Actions are available and execute correctly. (Create project — the library's own dialog; Upload files to the page's song or project — offered only where that page accepts a drop; Play/Pause the loaded track; Go to Library, Recent, Favorites, Shared with me, Settings. Recent items when the query is empty.)
- [x] Input is debounced and superseded requests are cancelled. (180 ms debounce; every superseded request is aborted, and a late answer to an old query is never shown — tested by releasing answers out of order. Loading, empty, and unreachable states are said in words in a `role="status"` line.)

**Where the negative test lives.** Search is composed in the web layer (db query + authz resolver), so its negative tests sit with the service rather than in the `packages/authz` IDOR registry; they run against a real database with the real resolver.

**Not verified here.** Manual QA 1–3 need a browser; none is available in this environment (task `120`).

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db test
```

## Manual QA

1. Search a lyric phrase and confirm the right song appears.
2. As a limited collaborator, search a term unique to an inaccessible song; confirm zero results.
3. Type rapidly and confirm no stale result flicker.

## Rollback/compatibility

Additive. Reverting loses search. The search indexes are additive migrations.

## Status

`complete`

## Commit

`b1db9fd`
