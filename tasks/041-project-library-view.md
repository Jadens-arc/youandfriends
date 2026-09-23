# 041 — Project library view

**Phase:** Library navigation · **Iteration:** one

## Objective

Build the artwork-forward project library: cards with cover art, name, artist, song count, collaborators, and last activity, with grid/list switching, sorting, and secondary modules.

## User value

The first thing you see. It should look like a shelf of records, not a file listing.

## Scope

- Project cards prioritizing cover art, with name, artist, song count, collaborator avatars, and last activity.
- Grid and list modes with the preference persisted.
- Sorting by name, artist, recent activity, and created date.
- Secondary modules: recent songs, shared with me, favorites, collaborator activity, storage usage.
- Empty states that are warm rather than apologetic, and a first-run state that invites the first upload.
- Skeleton loading that matches final layout to avoid shift.

## Non-scope

- Song workspace (task `042`).
- Upload (phase 5) — the empty state links forward to it.
- Search (task `045`).

## Dependencies

`040`

## Files expected to change

```
apps/web/app/(workspace)/library/page.tsx
apps/web/components/library/project-card.tsx
apps/web/components/library/modules/**
packages/db/src/queries/projects.ts
```

**What actually changed, beyond this list** (CLAUDE.md §11, following tasks `032` and `040`):

- `packages/authz/src/library.ts`: `libraryAccessFrom`/`loadLibraryAccess` (project and song
  visibility, and "shared with me", resolved in memory against one load of the viewer's grants)
  and `projectCollaboratorsFrom`/`loadProjectCollaborators`. Plus exports in
  `packages/authz/src/index.ts` and pure tests in `packages/authz/src/library-projects.test.ts`.
- `apps/web/lib/library/{projects,sort,format}.ts` and their `__tests__`. This is the same
  use-case/pure-helper split as task `040`'s `lib/library/{folders,tree}.ts`.
- `apps/web/app/(workspace)/library/[[...path]]/project-shelf.tsx`: the shelf as its own async
  component so the page can stream it behind a matching skeleton. The page itself
  (`[[...path]]/page.tsx`, the path task `040` established) reads the preference cookies.
- `apps/web/components/library/{cover-art,project-grid,library-toolbar,library-skeleton,empty-states}.tsx`
  alongside `project-card.tsx` and `modules/**`.
- `apps/web/components/library/folder-tree/library-browser.tsx`: takes the shelf as `children`,
  in a content column beside a fixed-width tree.
- `packages/db/src/__tests__/factories.ts`: `makeFavorite`, `makeAuditEvent`, and
  `setUpdatedAt`, exported from `@youandfriends/db/testing`. `setUpdatedAt` exists because the
  `set_updated_at` trigger overwrites any `updated_at` a test writes, so recency ordering could
  not otherwise be tested.
- `tasks/040-folder-tree-navigation.md` had two `*emphasis*` spans that failed `pnpm
format:check`, so `release-check` was red on `main` before this task. They were reformatted
  here, in the same edit that records `040`'s commit SHA.
- `tasks/069-cover-art-renditions.md` (new) and scope notes in tasks `042` and `055`. See the
  deviations below.

**Deviation: cover art renders the placeholder for every project; real covers are task `069`.**
The card is built for artwork. `CoverArt` takes a `src`/`srcSet` pair and `sizes` per layout,
and its `<img>` path is tested. But nothing can produce a sized rendition from a stored original
yet: there are no image derivatives, and serving stored bytes is still task `067`. The only other
option was a grid of presigned full-resolution originals, which is the performance mistake this
task's own notes name, and it would put a bearer URL for every original into the page.
`readProjectLibrary` returns `cover: null`, typed as exactly `null`, and the card draws the
designed placeholder (initials in the serif, on one of the three accent tints, inside a faint
record groove). Nothing in product can attach artwork to a project yet either (upload is phase
5), so this is the state every real library is in today. Recorded as task `069` rather than left
in prose.

**Deviation: cards and module entries are not links yet.** No project or song route exists until
task `042`, and a card that opens a 404 is worse than one that opens nothing. Folder favourites do
link, to `/library/<id>`, which already exists. Task `042`'s scope now says to wire the rest.

**Deviation: the first-run state has no upload button.** Upload arrives in phase 5. The first-run
state explains what will happen and exposes an `uploadAction` slot. Task `055`'s scope now says to
fill it. It does not show a button that goes nowhere (CLAUDE.md §12).

**Deviation: view and sort preferences live in cookies, not `localStorage`.** Task `040` kept the
tree's expansion state in `localStorage`. Here the server has to know the layout before it
renders, or a list-mode user gets a grid for one frame and then the page jumps. That is exactly
the layout shift this task rules out. Cookie values are parsed against an allow-list
(`parseView`/`parseSort`), and anything else falls back to the default. The toolbar writes the
cookie and calls `router.refresh()`, so ordering and layout happen only on the server.

**Deviation: no `SplitPane` beside the tree.** Task `040` expected this task to bring it back. The
shelf has to render once for both layouts: below the drill-down on mobile, beside the tree on
desktop. `SplitPane` owns both of its panes, so using it would mean rendering the shelf twice. The
tree is a fixed-width column instead.

**Decisions recorded, not in the original notes:**

- _Collaborators_ means the people a project is open to: every member whose own resolution on
  that project's chain yields a role. It does not mean everyone in the workspace. It is computed
  only for projects that already passed the viewer's visibility filter.
- _Shared with me_ means projects with an active, non-deny grant held by the viewer on their
  chain, plus songs shared directly whose project the viewer cannot otherwise open. Workspace
  membership alone is not sharing. A song-only collaborator has no project cards, so this module
  is their whole library, and it is shown on the first-run screen too.
- _Collaborator activity_ reads the audit log, which is an owner surface. It shows only other
  members' events, only on live folder, project, or song targets the viewer can see, and only
  actions on the `CONTENT_ACTIVITY_ACTIONS` allow-list in `packages/db/src/queries/projects.ts`.
  Sign-ins, permission changes, invitations, and downloads never appear, and no `metadata` is
  selected.
- _Storage usage_ is gated by `view_settings`, the same check as the settings page, so a
  scope-limited collaborator does not see it.
- _Trash_ is listed among §4's secondary modules, but it has its own destination and its interface
  is deferred (`212`), so it is not duplicated here.
- A folder view shows projects anywhere in that folder's subtree. Secondary modules appear at the
  library root only.
- Modules fill by keyset paging (`collectVisible`) rather than one `LIMIT`, so a collaborator whose
  visible songs are far down the list still gets them. The scan is bounded at six pages of fifty.
  Cursors carry Postgres's own text timestamp, because a millisecond `Date` would skip rows that
  share a millisecond.

## Implementation notes

- Cover art is square with modest rounding and is never overlaid with heavy text (`docs/DESIGN.md` §11). Let the artwork carry the card.
- Serve responsive image sizes; a grid of full-resolution cover art is the easiest performance mistake available here.
- Compute song counts and last activity in the list query — a per-card request is an N+1 that shows up immediately at realistic sizes.
- Skeletons must match the real layout's dimensions or the page jumps when data lands.
- Missing cover art needs a considered placeholder in the Studio Notebook palette, not a grey box — it will be common early on.

**Findings from the required security and test-coverage reviews, all fixed before this task was
marked complete:**

1. **Card aggregates counted songs the viewer cannot see** (security, medium). A song hidden by a
   song-level deny was still counted in its project's song count. Its edits also still moved the
   card's "last activity". Either tells the viewer the song exists. Fixed:
   `LibraryAccess.deniedSongIds` lists the song-scope denies, and `listWorkspaceProjects` takes
   `excludeSongIds` inside the same single statement. A denied song is the only way a song can
   be hidden inside a visible project.
2. **A song shared on its own named its hidden project** (security, medium). Recent songs and
   Shared with me printed the project's name. Adding the payload check for this then showed that
   collaborator activity and favourites also carried that project's id. Fixed: `SongSummary`,
   `ActivityItem`, and `FavoriteItem` carry a project id or name only when the viewer can open the
   project. The modules then say just "Song". This is the same rule as `breadcrumbFor` (task `040`).
3. **The streamed shelf's refusal was not 404-shaped** (security, low). This only happens if
   membership is removed between the page's tree read and the shelf's read. Fixed: `ProjectShelf`
   maps `not_found` to `notFound()`, as the page does.
4. **Collaborator activity named people who had left the workspace** (security, low). Fixed: the
   activity query joins current memberships.
5. **Opening a folder was tested only as the owner** (test review, blocking). With that test
   alone, dropping the visibility filter on the folder branch left every test green. Fixed: the
   shared fixture is now read inside folders by the project-denied editor and by scope-limited
   collaborators.

The fixture gained the rows each fix needs to bite: an editor with a song-level deny, and a former
member with activity on a visible target. The unit also gained assertions that the payload never
contains the hidden project's id. Each fix was mutated back out and the named test failed.

## Security/privacy considerations

Every query is workspace-scoped through `authz`. Collaborator avatars expose membership; only show collaborators on projects the viewer can access. Secondary modules must apply the same filtering — 'recent activity' is a classic place for an unfiltered query to leak.

## Acceptance criteria

- [x] Project cards render artwork-forward with all required metadata. (`components/library/__tests__/project-card.test.tsx`. The artwork is the designed placeholder until task `069`; see the deviation above.)
- [x] Grid/list switching works and persists. (`library-toolbar.test.tsx` covers the cookie write and refresh. `library/__tests__/page.test.tsx` covers the server honouring the cookie and a tampered value falling back to the default.)
- [x] Sorting works across all offered fields. (`lib/library/__tests__/sort.test.ts` covers every field. `library-toolbar.test.tsx` checks each field is offered and can be chosen. Opening the Radix listbox itself is left to task `016`'s real-browser coverage: in jsdom it pins the worker.)
- [x] Secondary modules render and are authorization-filtered. (`lib/library/__tests__/projects.test.ts`, against a real database and the real `authz`, with a populated foreign tenant, denies, and hidden targets. `library-modules.test.tsx` covers rendering.)
- [x] Empty and first-run states are designed, not default. (`library-states.test.tsx`, `project-shelf.test.tsx`.)
- [x] Skeletons match final layout dimensions. (The skeleton uses the grid's own `GRID_CLASSES`/`LIST_CLASSES`, and the card's square cover and metadata-row heights, asserted in `library-states.test.tsx`. Not checked by pixel measurement in a real browser.)
- [x] No N+1 queries at realistic library sizes. (`projects.test.ts`, "query count": the statement count is identical before and after adding 40 projects of 3 songs each.)

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter web test -- --coverage
pnpm build
```

As written, `pnpm --filter web test -- --coverage` hands vitest a literal `--` and collects no
coverage. It passes without measuring anything. Coverage was run for real with
`pnpm --filter web test:coverage` (`vitest run --coverage`): the thresholds were met, with 89% of
lines and 81% of functions against the 80% ratchet.

## Manual QA

1. Seed a realistic library and judge the grid against `docs/DESIGN.md` §4.
2. Confirm 'recent activity' as a limited collaborator shows only permitted items.
3. Throttle the network and watch for layout shift.

## Rollback/compatibility

UI plus queries. Reverting loses the library view.

## Status

`complete`

## Commit

_(not yet)_
