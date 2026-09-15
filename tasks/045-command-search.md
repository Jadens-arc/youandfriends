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

- [ ] The palette opens by keyboard shortcut and by click.
- [ ] Search covers project names, song titles, file names, and lyrics text.
- [ ] Lyrics search uses a GIN-indexed tsvector, not a scan.
- [ ] Results are authorization-filtered in the query.
- [ ] A collaborator cannot find content they lack access to, proven by test.
- [ ] Actions are available and execute correctly.
- [ ] Input is debounced and superseded requests are cancelled.

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

`pending`

## Commit

_(not yet)_
