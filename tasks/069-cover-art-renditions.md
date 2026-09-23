# 069 — Cover art renditions and delivery

**Phase:** Media pipeline · **Iteration:** one

## Objective

Produce sized renditions of a project's cover art from its stored original, and serve them to the
project library and song workspace as a `src`/`srcSet` pair.

## User value

The library is supposed to look like a shelf of records. Until this lands, every project shows its
placeholder cover, including projects that already have artwork attached.

## Why this exists

Split out of task `041` before it was marked complete. `041` built the card to take a cover
(`CoverArt` in `apps/web/components/library/cover-art.tsx` renders `srcSet` and `sizes` when it
gets one), but nothing can produce one yet:

- No path turns an artwork original into a small image. The `derivatives` table (task `026`) and
  the job orchestration (task `064`) are built for audio.
- No read path serves stored bytes to a browser with the right type yet. That is task `067`.
- A grid of presigned full-resolution originals is the performance mistake `041`'s task notes
  name. It would also put a bearer URL for every original into the page payload.

So `readProjectLibrary` returns `cover: null` for every project and the card draws the designed
placeholder. That is stated in the code and in `041`'s task file, not hidden.

## Scope

- Artwork derivatives: square renditions at a small fixed set of widths (for example 128, 256,
  512), recorded as `derivatives` rows against the artwork's asset version.
- Decode and resize through the media pipeline's validated path. Only the image types the
  `packages/media` allowlist accepts, with a pixel-count ceiling so a decompression bomb is refused
  before it is resized.
- A read path that returns rendition URLs for projects the viewer can already see, workspace-scoped
  and authorized through `packages/authz`, with short TTLs, never logged, and never persisted.
- `readProjectLibrary` fills `ProjectCard.cover` from it without adding a query per card.
- The song workspace header (task `042`) uses the same renditions.

## Non-scope

- Choosing or uploading artwork (upload phase 5; project metadata editing, task `043`).
- Animated artwork.

## Dependencies

`064`, `067`, `058`

## Files expected to change

```
packages/media/src/artwork.ts
apps/jobs/src/artwork.ts
packages/db/src/queries/projects.ts
apps/web/lib/library/projects.ts
apps/web/lib/library/__tests__/**
```

## Implementation notes

- Renditions are derivatives, never replacements. The original stays byte-for-byte untouched
  (CLAUDE.md §12, originals are sacred).
- Resolve covers for the whole visible project list in one query, the same way `041` computes
  song counts. A per-card presign loop is an N+1.
- Strip metadata (EXIF, GPS) from renditions. A phone photo used as cover art can carry the
  location it was taken.

## Security/privacy considerations

Rendition URLs are bearer credentials (CLAUDE.md §9). Covers are resolved only for projects that
already passed the viewer's visibility filter. A cover for a project the viewer cannot open must
not reach them, including inside a module entry.

## Acceptance criteria

- [ ] Uploading artwork produces renditions at every configured width, recorded as derivatives.
- [ ] Library cards and rows render the renditions through `srcSet`/`sizes`, never the original.
- [ ] Renditions carry no EXIF or location metadata.
- [ ] An oversized or malformed image is refused, and the refusal is surfaced, not swallowed.
- [ ] Cover resolution adds a fixed number of queries per library load, not one per card.
- [ ] A project the viewer cannot see never contributes a cover URL to their payload.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
pnpm --filter web test
pnpm release-check
```

## Manual QA

1. Attach artwork to a project and confirm the library card shows it with no layout shift.
2. Inspect the network panel on a wide and a narrow viewport and confirm different renditions load.

## Rollback/compatibility

Additive. Reverting returns every card to its placeholder. No data is lost.

## Status

`pending`

## Commit

_(not yet)_
