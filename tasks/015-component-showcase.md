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
apps/web/app/_showcase/**
apps/web/app/_showcase/page.tsx
apps/web/middleware.ts
```

## Implementation notes

- The route must be **excluded from production builds or gated by environment**, not merely unlinked. An unlisted route is still a reachable route.
- Showcase pages must use the real component exports, never local copies, or the showcase drifts and stops being evidence.
- Group by component with every state visible simultaneously, so a regression in a rarely-seen state is obvious.
- This is where the build prompt's 'Storybook or isolated showcase if it materially accelerates consistency' is answered — we chose the in-app route; note the reasoning in the file header.

## Security/privacy considerations

The showcase must not be reachable in production. It renders no user data and must never be wired to real records — it uses fixtures only, so it cannot become an information-disclosure surface.

## Acceptance criteria

- [ ] Every primitive appears in all its states.
- [ ] Token sheets render color, type, radii, elevation, and motion.
- [ ] The route is unreachable in a production build (verified, not assumed).
- [ ] Components are imported from `@youandfriends/ui`, not duplicated.
- [ ] Stable test anchors exist for task `120`.

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

`pending`

## Commit

_(not yet)_
