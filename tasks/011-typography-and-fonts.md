# 011 — Typography system and font loading

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Establish the three-voice typographic system — editorial serif for titles, neutral sans for interface, restrained monospace for lyrics and timestamps — with privacy-respecting local hosting and no layout shift.

## User value

Long writing and reading sessions stay comfortable, and the product reads as an editorial object rather than a dashboard.

## Scope

- Select and self-host three families; subset to the character sets actually needed.
- `next/font/local` integration with `display: swap` and correct fallback metrics to avoid CLS.
- A type scale: display, title, heading, body, caption, and a distinct lyric scale with generous line height.
- Tabular/lining figures for timestamps and durations so digits do not jitter during playback.
- Typography tokens exposed through the Tailwind preset.

## Non-scope

- Full internationalization or non-Latin scripts.
- Variable-font animation.
- Per-user typography preferences (deferred).

## Dependencies

`010`

## Files expected to change

```
packages/ui/src/styles/typography.css
packages/ui/src/fonts/**
apps/web/app/fonts.ts
packages/config/src/tailwind/preset.ts
packages/ui/src/__tests__/typography.test.ts
```

## Implementation notes

- Fonts are self-hosted — no requests to a third-party font CDN. This is a privacy requirement from `docs/DESIGN.md` §11, not a performance preference.
- Fallback font metrics must be adjusted (`size-adjust`, `ascent-override`) so the swap does not shift layout. Measure CLS, do not assume it.
- Timestamps and durations must use tabular figures; proportional digits visibly jitter as a playhead advances, which reads as a bug.
- The lyric face needs comfortable line height and measure — this is the surface people spend the longest time in.
- Subset aggressively; a full unsubsetted serif is a large payload for a handful of headings.

## Security/privacy considerations

Self-hosting fonts removes a third-party request that would otherwise leak user IP addresses and browsing patterns to a font provider on every page load.

## Acceptance criteria

- [x] Three families load from local assets with no third-party font requests.
- [x] Cumulative Layout Shift from font swap measures below 0.01 on the library and song views.
- [x] Timestamps and durations render with tabular figures.
- [x] The type scale is available as tokens and used by components rather than ad hoc sizes.
- [x] Font licenses permit self-hosted web use and are recorded in `docs/adr/` or a `LICENSES` note.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/ui test
pnpm build
# Confirm no third-party font requests in the network panel
```

## Manual QA

1. Load the app on a throttled connection and watch for text reflow.
2. Start playback and confirm the timestamp does not change width as it counts.
3. Read a full lyric sheet and judge comfort at desktop and phone sizes.

## Rollback/compatibility

Additive. Reverting falls back to system fonts — legible but off-brand. No data impact.

## Status

`complete`

## Commit

_(not yet)_
