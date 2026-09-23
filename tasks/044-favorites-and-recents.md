# 044 — Favorites, recents, and activity

**Phase:** Library navigation · **Iteration:** one

## Objective

Implement favoriting, a recently-played/recently-viewed list, and a collaborator activity feed, each authorization-filtered.

## User value

Getting back to what you were working on yesterday without navigating the whole tree.

## Scope

- Favorite toggle on songs and projects with optimistic update.
- A Favorites destination in the navigation.
- Recently played and recently viewed, tracked per user.
- A collaborator activity feed over audit events, filtered to what the viewer may see.
- Sensible retention on recents so the list stays useful.

## Non-scope

- Full audit browsing (deferred `207`).
- Cross-workspace activity.
- Notification delivery (phase 9).

## Dependencies

`042`, `024`

## Files expected to change

```
packages/db/src/schema/{favorites,recents}.ts
apps/web/app/(workspace)/favorites/**
apps/web/components/library/activity-feed.tsx
packages/db/src/queries/activity.ts
```

## Implementation notes

- The activity feed reads audit events, so it must apply authorization filtering **per event target** — this is the single most likely place in the product for a cross-permission leak, because one query returns rows about many different objects.
- Recording a 'recently viewed' entry on every page view is a write on every read. Debounce and deduplicate, or the table grows faster than the content it describes.
- Favorites are per user, not per workspace — two collaborators favorite independently.
- Cap recents per user and prune, rather than accumulating indefinitely.

## Security/privacy considerations

The activity feed is a high-risk aggregation surface (T1, T2). Every event must be filtered against the viewer's access to that specific target, not against workspace membership alone. This gets an explicit test with a collaborator who can see one song in a project and must not see activity about its siblings.

## Acceptance criteria

- [x] Favoriting works on songs and projects and is per user. (`PUT /api/favorites`, optimistic `FavoriteToggle` in the song header and on the project page, rolling back with a sentence on failure; `lib/library/__tests__/personal.test.ts` shows two people's favourites staying apart, idempotence, and refusal for an unseen or foreign target.)
- [x] The Favorites destination lists favorited items. (`/favorites`, grouped by songs, projects, folders; only targets the person can still open.)
- [x] Recents track views and plays without a write amplification problem. (New `recents` table, migration `0014`: one row per person, kind, and target, moved forward by an upsert that does nothing inside a five-minute window — the test revisits within a minute and nothing is written. Views are recorded by a beacon after render; `recordPlay` is exported for the player, task `070`.)
- [x] The activity feed filters per event target, proven by a test with a narrowly scoped collaborator. (A collaborator granted one song of three, with edits on all three and on the project by two people, sees only their song's events; the editor sees all four targets. `/recent` shows the workspace feed; a song's "Comments & activity" tab shows its own.)
- [x] Recents are capped and pruned. (Fifty per person and kind; the test records fifty-five plays and fifty remain, newest first.)

`recents` is registered with the IDOR suite and `scopedQuery` like `favorites`. The Shared destination now renders the library's filtered "Shared with me" list rather than a placeholder.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Favorite a song, confirm it appears under Favorites.
2. As a collaborator with access to one song in a project, confirm activity shows nothing about sibling songs.
3. View many songs and confirm recents stay capped.

## Rollback/compatibility

Additive. Reverting loses convenience features; no core data impact.

## Status

`complete`

## Commit

`1838e8c`
