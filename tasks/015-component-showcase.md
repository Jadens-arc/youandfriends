# 015 — Isolated component showcase

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Provide a development-only route rendering every design-system component in its states, so visual consistency can be checked in one place rather than hunted across the app.

## User value

Indirect: it materially reduces the cost of keeping the visual system coherent as the surface grows, and gives Playwright a stable target for visual assertions.

## Scope

- A `/_showcase` route, available in development and in preview deployments only.
- Every primitive from task `012` in its default, hover, focus, active, disabled, loading, and error states.
- Token sheets: color, type scale, radii, elevation, motion.
- Desktop and iPhone viewport framing for responsive components.
- Stable `data-testid` anchors for the Playwright visual assertions in task `120`.

## Non-scope

- Storybook as a separate tool — a route inside the app is lighter and shares the real token pipeline. Recorded as a deliberate choice here.
- Pixel-perfect screenshot diffing (task `120` keeps assertions deliberately non-brittle).
- Product components that require data.

## Dependencies

`012`, `013`, `014`

## Files expected to change

```
apps/web/app/%5Fshowcase/**
apps/web/app/%5Fshowcase/page.dev.tsx
apps/web/proxy.ts
apps/web/next.config.ts
apps/web/lib/showcase.ts
```

Two names differ from the plan, both forced by the framework:

- `app/_showcase/` would not be a route at all. An underscore-prefixed folder is a _private
  folder_ in the App Router and opts itself and everything under it out of routing. `%5F` is
  the documented way to get a URL segment that starts with an underscore, so the directory is
  `app/%5Fshowcase/` and the URL is still `/_showcase`.
- `middleware.ts` is deprecated in Next 16 and renamed to `proxy.ts`. Same capability, same
  matcher semantics, different file and export name.

## Implementation notes

- The route must be **excluded from production builds or gated by environment**, not merely unlinked. An unlisted route is still a reachable route.
- Showcase pages must use the real component exports, never local copies, or the showcase drifts and stops being evidence.
- Group by component with every state visible simultaneously, so a regression in a rarely-seen state is obvious.
- This is where the build prompt's 'Storybook or isolated showcase if it materially accelerates consistency' is answered — we chose the in-app route; note the reasoning in the file header.

## Security/privacy considerations

The showcase must not be reachable in production. It renders no user data and must never be wired to real records — it uses fixtures only, so it cannot become an information-disclosure surface.

## Acceptance criteria

- [x] Every primitive appears in all its states — every state that can be _declared_. A test
      enumerates `packages/ui/src/components/*.tsx` and fails if a primitive is not on the
      page, so this cannot silently rot. `:hover`, `:focus-visible`, and `:active` are
      browser states that no static markup produces; reproducing their classes by hand would
      be the local copy this task forbids, so they are anchored for task `120` instead. Said
      plainly on the page itself rather than implied.
- [x] Token sheets render color, type, radii, elevation, and motion.
- [x] The route is unreachable in a production build — verified, not assumed. See below.
- [x] Components are imported from `@youandfriends/ui`, not duplicated — asserted by a test
      that rejects any relative or `packages/ui/src` import in the showcase.
- [x] Stable test anchors exist for task `120`: 52 `data-testid` anchors, one per section and
      one per state group.

## Verification of the production gate

Two locks, the first structural:

1. The route files are named `page.dev.tsx`, and `dev.tsx` is a page extension only outside
   production (`next.config.ts`). In production the route is **absent from the build output**
   — there is no handler left to decide anything.
2. `proxy.ts` refuses `/_showcase` and everything under it when the gate is off, which catches
   the case where someone renames the file back to `page.tsx`.

Run against a real production build (`pnpm build && pnpm start`):

```
Route (app)          # production build — no /_showcase
┌ ○ /
├ ○ /_not-found
├ ○ /favorites  ├ ○ /library  ├ ○ /recent  ├ ○ /search  ├ ○ /shared  └ ○ /trash

/library        -> 200
/_showcase      -> 404
/_showcase/x    -> 404
```

The same build contains no showcase code at all: `grep -rl 'showcase-section' .next/server
.next/static` returns nothing. With `VERCEL_ENV=preview` the route appears in the build and
serves 200, so the gate is a gate and not a permanent off switch.

## Decisions taken

- **A route, not Storybook.** The build prompt leaves this open. A route inside the app shares
  the real token pipeline, fonts, Tailwind build, and component exports; Storybook is a second
  build to keep in sync, and the bug it would most likely miss — a token resolving differently
  in the app than in the story — is the one this page exists to catch.
- **Responsive framing uses real iframes.** A fixed-width `div` still resolves `md:` against
  the outer viewport, so it would show the desktop shell at phone width: the wrong answer,
  confidently. An iframe has its own viewport.
- **The showcase is excluded from coverage** (`apps/web/vitest.config.ts`). Its uncovered
  surface is inert demo callbacks; calling them from a test would measure the fixture. What
  matters about it is asserted structurally, and its rendering is task `120`'s in a browser.
- **`@/*` is now aliased in `apps/web/vitest.config.ts`**, mirroring `tsconfig.json`. Without
  it `proxy.ts` resolved under Next and failed under Vitest.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
# verify /_showcase returns 404 against a production build
```

## Manual QA

1. Visit the showcase in development and review against `docs/DESIGN.md` §11.
2. Build for production and confirm the route is not reachable.
3. Check the showcase at desktop and iPhone widths.

## Rollback/compatibility

Development-only surface. Reverting loses a QA aid; no product impact. Task `120` depends on its test anchors.

## Status

`complete`

## Commit

_(not yet)_
