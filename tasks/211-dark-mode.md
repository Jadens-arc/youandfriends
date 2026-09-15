# 211 — Dark mode

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Design and implement a dark variant of the Studio Notebook system — designed deliberately, never mechanically inverted.

## User value

Working at night without a bright screen.

## Scope

- A designed dark palette preserving Studio Notebook character: warm, tactile, editorial.
- Token redefinition under `prefers-color-scheme` and an explicit user preference.
- Contrast verification for every dark token pair.
- Artwork and waveform treatment adjusted for dark surfaces.
- A theme toggle with system, light, and dark options.

## Non-scope

- Mechanical inversion of the light palette — explicitly forbidden by `docs/DESIGN.md` §11.
- High-contrast or other accessibility themes.
- Per-component theme overrides.

## Dependencies

`010`

## Files expected to change

```
packages/ui/src/styles/tokens.css
packages/config/src/tailwind/preset.ts
apps/web/components/theme-toggle.tsx
```

## Implementation notes

- `docs/DESIGN.md` §11 is explicit: light mode is the primary identity and dark must not be a mechanical inversion. A warm cream notebook inverted becomes a muddy brown screen; the dark variant needs its own design pass.
- Espresso navigation already works on dark. The hard part is the canvas — it needs to read as a dark studio surface rather than as a generic dark grey app.
- Every dark token pair needs its own contrast verification (task `010`'s test extends to cover it).
- Artwork on dark needs different border and shadow treatment; waveforms need a different peak color to stay legible.
- The token architecture from task `010` makes this a token change plus a design pass, not a component rewrite — which is exactly why tokens were centralized.

## Security/privacy considerations

No security implications.

## Acceptance criteria

- [ ] A designed dark palette preserves Studio Notebook character without mechanical inversion.
- [ ] Tokens redefine under `prefers-color-scheme` and an explicit preference.
- [ ] Every dark token pair passes WCAG 2.2 AA contrast.
- [ ] Artwork and waveform treatments are adjusted for dark surfaces.
- [ ] A theme toggle offers system, light, and dark.
- [ ] No component required changes beyond tokens.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/ui test
pnpm test:e2e -- accessibility
```

## Manual QA

1. Review every surface in dark mode against the Studio Notebook character.
2. Verify contrast across all dark surfaces.
3. Toggle between themes and confirm no flash of incorrect theme.

## Rollback/compatibility

Additive tokens. Reverting removes dark mode.

## Status

`pending`

## Commit

_(not yet)_
