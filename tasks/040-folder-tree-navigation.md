# 040 — Folder tree and library navigation

**Phase:** Library navigation · **Iteration:** one

## Objective

Render the nestable folder tree with authorization-filtered contents, expand/collapse persistence, keyboard navigation, and drag-to-move.

## User value

Finding things. The organizational spine of the library, visible on wide screens and drill-down on mobile.

## Scope

- Folder tree on wide screens, filtered by `authz` so inaccessible folders are absent, not merely hidden.
- Expand/collapse state persisted per user.
- Full keyboard navigation following the tree view interaction pattern.
- Create, rename, move, and delete folders, with move updating the materialized subtree path.
- Drag-to-move with a keyboard-accessible alternative.
- Breadcrumbs reflecting the current path.

## Non-scope

- Project cards and the grid (task `041`).
- Search (task `045`).
- Trash UI (deferred `212`).

## Dependencies

`032`, `013`, `014`

## Files expected to change

```
apps/web/components/library/folder-tree/**
apps/web/app/(workspace)/library/**
packages/db/src/queries/folders.ts
apps/web/components/library/__tests__/**
```

## Implementation notes

- Filtering must happen in the query through `scopedQuery`, never by rendering and hiding. A folder the user cannot access must never reach the client (T1).
- Fetch the tree in one query using the materialized path rather than a request per level.
- Implement the ARIA tree view pattern properly: roving tabindex, arrow-key traversal, Home/End, type-ahead. A tree that is only mouse-operable fails the accessibility requirement.
- Drag-and-drop **must** have a keyboard-accessible equivalent — a 'Move to…' command — or the feature is inaccessible.
- Moving a folder is transactional across the subtree (task `021`); surface failure clearly rather than leaving a half-moved tree.

## Security/privacy considerations

Authorization filtering at the query layer is the control here. A folder's mere existence is information — an inaccessible folder must not appear as a greyed-out row. Move and delete are audited.

## Acceptance criteria

- [ ] The tree renders nested folders filtered by authorization at the query layer.
- [ ] Inaccessible folders are absent from the response payload, verified by inspecting the network response.
- [ ] Expand/collapse persists per user.
- [ ] Full keyboard navigation follows the ARIA tree pattern.
- [ ] Create, rename, move, and delete work; move updates the whole subtree.
- [ ] Drag-to-move has a keyboard-accessible alternative.
- [ ] Breadcrumbs reflect the current path.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Sign in as a collaborator with access to one folder; confirm the network response contains no other folder.
2. Navigate the entire tree by keyboard only.
3. Move a deep folder and confirm breadcrumbs and paths update everywhere.

## Rollback/compatibility

UI plus queries. Reverting loses navigation but no data.

## Status

`pending`

## Commit

_(not yet)_
