# 012 — shadcn primitives restyled into Studio Notebook

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Install the shadcn primitives the product needs and restyle every one into the Studio Notebook system. Stock shadcn styling must not ship.

## User value

Controls feel like part of a considered object rather than a component library demo, and behave consistently everywhere.

## Scope

- Primitives: button, input, textarea, select, dialog, sheet, dropdown-menu, tooltip, tabs, toast, avatar, badge, checkbox, switch, slider, scroll-area, separator, skeleton, context-menu, command.
- Each restyled against tokens from task `010`: warm borders, 8–14 px radii, restrained shadows, ink-tinted focus rings.
- Dark espresso control variants with soft inset highlights for the navigation rail and player.
- A visible, tasteful focus ring on every interactive primitive.
- Minimum 44×44 px hit targets for every control that appears on mobile.

## Non-scope

- Composite product components — project cards, waveform, player (their own tasks).
- A component showcase route (task `015`).
- Animation beyond the motion tokens.

## Dependencies

`010`, `011`

## Files expected to change

```
packages/ui/src/components/**
packages/ui/src/lib/cn.ts
packages/ui/components.json
packages/ui/src/__tests__/components/**
```

## Implementation notes

- Restyle by editing the copied primitive source — shadcn primitives are owned code, not a dependency to override with wrapper classes.
- Avoid pill shapes. The design explicitly calls for mostly 8–14 px radii; fully rounded controls read as generic SaaS.
- Focus rings must be visible against both cream and espresso surfaces — that is two ring treatments, resolved by token, not one compromise.
- Hit-target padding must not visually inflate dense desktop lists; use pseudo-element expansion so touch targets grow without changing layout.
- Every primitive gets a Testing Library test for keyboard operation, not just rendering.

## Security/privacy considerations

Focus visibility and keyboard operation are accessibility controls with legal and practical weight. Dialogs and sheets must trap focus correctly and restore it on close — a focus trap bug can strand a keyboard or screen-reader user.

## Acceptance criteria

- [ ] Every listed primitive is installed and restyled against tokens; no stock shadcn appearance remains.
- [ ] Every interactive primitive shows a visible focus ring on both cream and espresso surfaces.
- [ ] Dialog and sheet trap focus and restore it to the trigger on close.
- [ ] All mobile-visible controls meet 44×44 px.
- [ ] No raw color literals (lint rule from task `010` passes).
- [ ] Keyboard operation tests pass for every primitive.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/ui test
pnpm lint
pnpm typecheck
```

## Manual QA

1. Tab through every primitive and confirm focus is always visible and never lost.
2. Open and close a dialog and a sheet with the keyboard only; confirm focus returns to the trigger.
3. Check hit targets on a real phone or accurate device emulation.

## Rollback/compatibility

Additive within `packages/ui`. Reverting removes primitives that later tasks depend on; revert dependents first.

## Status

`pending`

## Commit

_(not yet)_
