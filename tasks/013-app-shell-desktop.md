# 013 — Desktop application shell

**Phase:** Studio Notebook design system · **Iteration:** one

## Objective

Build the desktop shell: espresso navigation rail, warm cream content canvas, persistent bottom player region, and the split project/song layout.

## User value

The frame the whole product lives in — navigation that stays put, content that breathes, and a player that never interrupts itself.

## Scope

- Fixed espresso navigation rail with library, recent, shared, favorites, and trash destinations.
- Warm cream canvas with the paper-grain overlay applied once at shell level.
- A persistent bottom player region reserved in layout, so mounting the player never reflows content.
- Split layout primitive for the project view: song list left, selected-song detail right, with a resizable divider.
- Command/search entry always reachable, including by keyboard shortcut.
- Route transitions that do not unmount the player region.

## Non-scope

- Player behavior and audio (tasks `070`–`071`). This task reserves the region and defines the slot.
- Library data (task `041`) — the shell renders against fixtures.
- Mobile shell (task `014`).

## Dependencies

`012`

## Files expected to change

```
apps/web/app/(workspace)/layout.tsx
apps/web/components/shell/**
packages/ui/src/components/split-pane.tsx
apps/web/app/(workspace)/**
```

## Implementation notes

- The player region must live **above** the route segment in the layout tree so route changes never unmount it. This is the structural decision the whole 'listening never breaks' principle depends on — get it right here or retrofit it painfully in task `071`.
- Reserve the player's height in the layout even when nothing is playing, to avoid a content jump on first play.
- The split divider position should persist per user in local storage, not per session.
- The grain overlay belongs on one shell element, not repeated per card.
- Navigation rail items need accessible names and a clear current-page indication that is not color alone.

## Security/privacy considerations

No data access in this task. Navigation must not reveal the existence of destinations the user cannot access — that filtering arrives with real data in task `041` and must be driven by `authz`, never by hiding in CSS.

## Acceptance criteria

- [x] The navigation rail renders with correct tokens and accessible names.
- [x] Current destination is indicated by more than color.
- [x] The player region is reserved in layout and survives a route change without unmounting.
- [x] The split pane resizes, respects sensible minimums, and persists its position.
- [x] Command entry opens by keyboard shortcut and by click.
- [x] The shell is fully keyboard navigable in a logical order.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
```

## Manual QA

1. Navigate between routes and confirm the player region element is never recreated (check via devtools element identity).
2. Resize the split pane, reload, confirm position persists.
3. Traverse the entire shell with the keyboard only.

## Rollback/compatibility

Structural. Reverting breaks every workspace route. Must land before tasks `040`+.

## Status

`complete`

## Commit

`0d8b593`
