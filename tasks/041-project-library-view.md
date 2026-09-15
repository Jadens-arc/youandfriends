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

## Implementation notes

- Cover art is square with modest rounding and is never overlaid with heavy text (`docs/DESIGN.md` §11). Let the artwork carry the card.
- Serve responsive image sizes; a grid of full-resolution cover art is the easiest performance mistake available here.
- Compute song counts and last activity in the list query — a per-card request is an N+1 that shows up immediately at realistic sizes.
- Skeletons must match the real layout's dimensions or the page jumps when data lands.
- Missing cover art needs a considered placeholder in the Studio Notebook palette, not a grey box — it will be common early on.

## Security/privacy considerations

Every query is workspace-scoped through `authz`. Collaborator avatars expose membership; only show collaborators on projects the viewer can access. Secondary modules must apply the same filtering — 'recent activity' is a classic place for an unfiltered query to leak.

## Acceptance criteria

- [ ] Project cards render artwork-forward with all required metadata.
- [ ] Grid/list switching works and persists.
- [ ] Sorting works across all offered fields.
- [ ] Secondary modules render and are authorization-filtered.
- [ ] Empty and first-run states are designed, not default.
- [ ] Skeletons match final layout dimensions.
- [ ] No N+1 queries at realistic library sizes.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter web test -- --coverage
pnpm build
```

## Manual QA

1. Seed a realistic library and judge the grid against `docs/DESIGN.md` §4.
2. Confirm 'recent activity' as a limited collaborator shows only permitted items.
3. Throttle the network and watch for layout shift.

## Rollback/compatibility

UI plus queries. Reverting loses the library view.

## Status

`pending`

## Commit

_(not yet)_
