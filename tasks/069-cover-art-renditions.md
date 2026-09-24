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

- [x] Uploading artwork produces renditions at every configured width, recorded as derivatives. (A recorded artwork version is enqueued with the `artwork` operation; `produceCoverRenditions` in `apps/jobs/src/artwork.ts` renders a square JPEG at 128, 256 and 512 px — `COVER_RENDITION_WIDTHS` — each a `thumbnail` derivative named `cover-<width>`, with the same idempotency as audio: each rendition's row names its object, and a recorded one is not rendered again on retry. Tested end to end, including a retry after a partial run.)
- [x] Library cards and rows render the renditions through `srcSet`/`sizes`, never the original. (`resolveCovers` in `apps/web/lib/library/covers.ts` fills `ProjectCard.cover`, the song header's and the project header's covers with `src` = the smallest rendition and a width-described `srcSet`; `CoverArt` already rendered them. Nothing reads the original.)
- [x] Renditions carry no EXIF or location metadata. (`-map_metadata -1` and the MJPEG encoder's bare JFIF header. Tested with a JPEG carrying an EXIF segment with a GPS pointer: the rendition has no `Exif`, no marker, and no APP1 segment.)
- [x] An oversized or malformed image is refused, and the refusal is surfaced, not swallowed. (`probeArtwork` in `packages/media/src/artwork.ts` checks the declared size against a 40-megapixel ceiling **before decoding** — tested with a hand-built PNG declaring 8000×8000 in a few hundred bytes — and refuses anything that is not a single JPEG, PNG or WebP still: SVG, text, audio, video. The version is recorded `failed` with a sentence — "This file doesn’t appear to be a JPEG, PNG, or WebP image." / "This image is too large to use as cover art." — shown with the file's "Processing failed" badge, and not retried.)
- [x] Cover resolution adds a fixed number of queries per library load, not one per card. (`listCoverRenditions` resolves every project on the page in one query, run in parallel with the page's other reads; signing is local. Tested by counting `execute` calls for five projects: one.)
- [x] A project the viewer cannot see never contributes a cover URL to their payload. (Covers are resolved only for projects that passed the visibility filter; a song shared on its own does not bring its hidden project's cover. Tested by searching the whole serialized payload for the hidden project's rendition keys, and mutation-checked.)

**Also in this task.**

- The sniffer now recognises JPEG, PNG and WebP (never SVG), and `image/jpeg` joins the servable allowlist so a rendition is served inline to an `<img>`; originals are still attachments (task `067`).
- **A 064 bug fixed:** every recorded asset version was sent down the audio pipeline, so a project file or artwork would have been marked "failed" for not being audio. Enqueueing now chooses by kind: audio kinds get the audio pipeline, artwork gets renditions, and anything else is marked ready with nothing to derive.
- With no derivatives bucket configured, cards keep their placeholder rather than failing the page.

**Limitation.** An EXIF orientation flag is not applied, so a phone photo stored sideways with an orientation tag renders sideways. Cover art is ordinarily exported upright and square.

**Manual QA** (a card in a browser, rendition choice across viewports) was not run: there is no browser harness until task `120` and no R2 bucket here.

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

`complete`

## Commit

_(not yet)_
