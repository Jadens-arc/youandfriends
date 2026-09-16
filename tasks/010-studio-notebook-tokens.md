# 010 — Studio Notebook foundation tokens

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Translate the Studio Notebook palette, spacing, radius, elevation, and motion direction from `docs/DESIGN.md` into CSS custom properties and a Tailwind preset, exposed as shadcn semantic tokens.

## User value

The warm, tactile character that distinguishes You & Friends from a generic file manager begins here. Every later screen inherits it for free.

## Scope

- CSS custom properties on `:root` for canvas, raised paper, espresso, ink, secondary text, olive, rust, ochre, and border-at-opacity.
- A Tailwind preset in `packages/config` mapping tokens to semantic shadcn names (`background`, `card`, `foreground`, `muted-foreground`, `accent`, `border`, `ring`).
- Radius scale concentrated in the 8–14 px band with a small/medium/large ladder.
- Elevation scale: fine warm borders and restrained shadows tinted with ink rather than pure black.
- Motion tokens: 150–220 ms durations and easing curves; a gentle spring for sheets.
- A subtle paper-grain overlay implemented as a single low-opacity repeating background, applied once at the shell level.

## Non-scope

- Dark mode — planned as deferred task `211`. Light mode is the primary identity and must not be mechanically inverted.
- Component implementations (task `012`).
- Font loading (task `011`).

## Dependencies

`000`, `001`

## Files expected to change

```
packages/config/src/tailwind/preset.ts
packages/ui/src/styles/tokens.css
packages/ui/src/styles/grain.css
packages/ui/src/__tests__/tokens.test.ts
apps/web/app/globals.css
```

## Implementation notes

- Colors are defined **once**, as tokens. A raw hex value in a component is a lint failure — add the rule in this task.
- Tune the exact production values while preserving the relationships in `docs/DESIGN.md` §11. Contrast is the constraint that decides final values, not aesthetics alone.
- The grain overlay must be a single small repeating asset or a CSS gradient — not a large PNG, and not a per-element filter, which would cost paint performance on scroll.
- Every token pair used for text-on-surface must be checked for WCAG 2.2 AA contrast **in this task**, not discovered later in task `121`.
- Motion tokens must resolve to `0ms` under `prefers-reduced-motion`, at the token layer, so components get it without opting in.

## Security/privacy considerations

Low direct risk. The contrast checks here are an accessibility control, and the no-raw-color lint rule is what keeps the system coherent under later pressure.

## Acceptance criteria

- [x] Every token from `docs/DESIGN.md` §11 exists as a CSS custom property.
- [x] The Tailwind preset maps tokens to shadcn semantic names.
- [x] An automated test asserts WCAG 2.2 AA contrast for every text-on-surface token pair.
- [x] `prefers-reduced-motion` reduces motion tokens to zero at the token layer.
- [x] A lint rule rejects raw hex/rgb color literals in `packages/ui` and `apps/web` components.
- [x] The grain overlay renders without measurable scroll jank at desktop and mobile viewports.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/ui test
pnpm lint
pnpm release-check
```

## Manual QA

1. Render a token sheet page and compare against the design direction in `docs/DESIGN.md` §11.
2. Enable reduced motion in OS settings and confirm transitions stop.
3. Inspect the grain at 100% and 200% zoom for readability impact.

## Rollback/compatibility

Token-only; reverting restores unstyled defaults and breaks visual consistency but no behavior. Must land before task `012`.

## Status

`complete`

## Commit

`cb23adb`
