# 073 — Playback queue and best-effort gapless

**Phase:** Persistent player · **Iteration:** one

## Objective

Implement the playback queue: building, reordering, removing, persistence across sessions, and best-effort gapless transitions via preloading.

## User value

Queuing up a project and letting it play through, with the queue still there tomorrow.

## Scope

- Queue built from a song, a project, a folder, or search results.
- Add next, add to end, remove, reorder by drag with a keyboard alternative.
- A queue panel showing upcoming tracks with the current position.
- Persistence across sessions with re-authorization on restore.
- Best-effort gapless via preloading the next item shortly before the current ends.
- Repeat modes (off, all, one) and shuffle.

## Non-scope

- Offline queue playback (deferred `203`).
- Collaborative or shared queues.
- Guaranteed gapless — Safari cannot deliver it and we do not claim it (`docs/OPERATIONS.md` §9).

## Dependencies

`070`, `071`

## Files expected to change

```
apps/web/lib/player/queue.ts
apps/web/components/player/queue-panel.tsx
apps/web/lib/player/__tests__/queue.test.ts
```

## Implementation notes

- A restored queue **must be re-authorized**. A persisted queue can contain a song whose access was revoked since, and playing it from local state would bypass authorization entirely. Re-check on restore and silently drop what is no longer permitted.
- Gapless is best-effort. Preload the next track into a second element and switch on `ended`. On Safari this reduces but does not eliminate the gap — say so in the docs rather than claiming gapless (`docs/DESIGN.md` §5 says 'where the browser permits').
- Preloading a second stream URL means a second authorization check — do it at preload time, not at switch time.
- Drag reordering needs a keyboard alternative, same as task `040`.
- Persist queue references (version ids), never stream URLs, which expire (T3).

## Security/privacy considerations

Queue restoration is an authorization boundary: persisted local state is untrusted and must be re-validated server-side before playback. Persisted queue state contains ids only, never presigned URLs.

## Acceptance criteria

- [x] Queues build from song, project, folder, and search results. (`POST /api/queue/resolve` → `resolveQueue` takes a song list, a project, a folder, or version ids, and returns only what this viewer may play — one load of their grants, each song at its current version (or newest), streamable versions only. "Play / Play next / Add to queue" on the project page, on an opened folder in the library, and on each ready version; search results use the same song-list selection once search exists (task `045`).)
- [x] Add next, add to end, remove, and reorder all work, with a keyboard path for reordering. (Pure operations in `lib/player/queue.ts`; the panel offers drag **and** Move up / Move down buttons on every row, announcing where a track went.)
- [x] The queue panel shows upcoming tracks and current position. (`QueuePanel`, from the player bar's Queue button: every entry in play order, the current one marked `aria-current` and "Now playing" in words.)
- [x] Queues persist across sessions and are re-authorized on restore. (Stored as version ids and positions; on start the ids go to the server, and only its answer is shown — nothing is displayed or played from storage. If the server cannot be asked, nothing is restored.)
- [x] Revoked items are dropped from a restored queue. (Tested end to end against a real database — a grant deleted between two resolves drops that version — together with missing, foreign-workspace and not-yet-streamable ids; the queue resumes at what followed a dropped current track.)
- [x] Preloading reduces the gap between tracks where the browser permits. (Twenty seconds before the end the next URL is fetched — authorized at preload time — and warmed in a detached element that never plays, so there is still only one playing element (task `070`); on `ended` that URL is used with no second request. `docs/OPERATIONS.md` §9 says exactly what this does and does not achieve on Safari.)
- [x] Repeat and shuffle work. (Repeat off / all / this track — "next" still moves on under repeat-one; shuffle reorders only what is still to come and turning it off restores the listener's own order.)
- [x] Persisted state contains no presigned URLs. (`toPersisted` writes ids, order, position, repeat and shuffle — tested to contain no URL and no title even when a track carries a signed cover URL.)

**Not verified here.** Tight transitions (Manual QA 1) need real audio in a browser — task `120`.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Queue a project, play through several tracks, confirm transitions are tight.
2. Revoke access to a queued song, reload, confirm it is dropped from the restored queue.
3. Reorder the queue by keyboard only.

## Rollback/compatibility

Additive. Reverting loses the queue; single-track playback remains.

## Status

`complete`

## Commit

_(not yet)_
