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

**What actually changed, beyond this list** (CLAUDE.md §11, following task `032`'s precedent):

- `packages/authz/src/library.ts` (new), plus small additions to `packages/authz/src/authorizer.ts`
  (`grantsForSubjectInWorkspace`, exported), `packages/authz/src/workspace.ts` (`membershipRowOf`),
  and `packages/authz/src/index.ts`. **`scopedQuery` turned out not to be the right tool here** —
  see the deviation below.
- `apps/web/lib/library/**` (`context.ts`, `folders.ts`, `tree.ts`) and their `__tests__`, holding
  the use cases and pure tree-shaping helpers — the same split as `apps/web/lib/workspace/**` and
  `apps/web/lib/invitations/**`.
- `apps/web/app/(workspace)/library/[[...path]]/page.tsx` (an optional catch-all, not a flat
  `page.tsx`) and a sibling `actions.ts`, replacing the task-`013`/`014` placeholder.
- `apps/web/app/(workspace)/__tests__/destinations.test.tsx` — `LibraryPage` removed from the
  shared placeholder sweep (it is no longer a placeholder); its own coverage moved to
  `library/__tests__/page.test.tsx`.
- `apps/web/components/shell/mobile/bottom-navigation.tsx` and
  `apps/web/components/shell/navigation-rail.tsx` — one-line casts (`'/library' as Route`), not
  behavior changes. Both are unavoidable fallout of the routing deviation below: Next's generated
  route type for an optional catch-all has no bare-segment member, only
  `` `/library/${OptionalCatchAllSlug<T>}` ``, so the literal `/library` these task-`013`/`014`
  files already wrote stopped type-checking the moment `page.tsx` became `[[...path]]/page.tsx`.

**Deviation: no `scopedQuery` call anywhere in this task.** The task file's own instruction
("filtering must happen in the query through `scopedQuery`") turned out to describe the wrong
tool once scope-limited collaborators (task `032`, ADR 0010) were taken into account.
`scopedQuery` opens a workspace-wide handle, and refuses to open one at all for a scope-limited
collaborator (`role: null` — by design, they have no workspace-wide baseline). It also can't
account for a `permission_grants` **deny** on one branch of the tree, because it filters purely
by `workspace_id`. Built instead: `packages/authz/src/library.ts`'s `loadVisibleFolders`, which
resolves each candidate folder independently against its own materialized-path chain (reusing the
existing pure `resolve()` from task `023`), against one bulk load of the subject's grants and
membership row. This is the same authorization decision `scopedQuery` and `createAuthorizer` both
make, applied to a "which of these may I see, and as what role" question neither of them answers
as written. See `packages/authz/src/library.ts`'s own doc comment for the full reasoning.

**Deviation: `edit`, not `manage`, gates create/rename/move/delete.** `ACTION_REQUIREMENTS.manage`
(`packages/contracts/src/actions.ts`) requires `owner`, but `docs/DESIGN.md` §3 is explicit that
an **editor** may "organize content" — folder structure is exactly that, and `manage`'s own doc
comment reads as being about permission-granting (already the separate `invite` action), not
content organization. Built: `edit` (minimum role `editor`) for all four folder-structure writes.
`manage` remains defined and unused, presumably for a later permission-editing surface.

**Deviation: expand/collapse state lives in `localStorage`, not the database.** The task's
acceptance criterion says "persists per user"; the precedent already in this codebase for exactly
that phrase (`SplitPane`'s `storageKey` prop, `packages/ui/src/components/split-pane.tsx`, "the
position is remembered, per user rather than per session") is `localStorage`, not a table. Adding
a `folder_tree_expansion` table and a migration for view-only UI state that carries no data of its
own was judged out of proportion; this follows the existing convention instead of inventing a
second one.

**Deviation: `/library/[[...path]]`, not a fixed `[folderId]` segment.** `apps/web/components/shell/mobile/mobile-header.tsx`
and `bottom-navigation.tsx` (task `014`) were already written against the convention that library
navigation is real nested routes — `/library`, `/library/<folder>`, and deeper — anticipating
tasks `041`–`042` adding a project and a song as further segments under the same folder. An
optional catch-all is what lets this task's routing keep that convention working today without
needing to be revisited when those tasks add depth.

**Deviation: no `SplitPane` on this page.** The task-`013`/`014` placeholder used `SplitPane` to
exercise the two-pane desktop layout ahead of real data. With only folders in this task's scope —
no project grid or song detail yet (`Non-scope`) — a right-hand pane would have had nothing honest
to show. The folder tree now takes the full content width; task `041` is expected to reintroduce
`SplitPane` once there is a project grid to put beside it.

## Implementation notes

- Filtering happens in `packages/authz/src/library.ts`, not by rendering and hiding — see the
  `scopedQuery` deviation above for why that module exists instead of the task's literal
  instruction. A folder the user cannot access never reaches the client (T1).
- The tree is fetched as one plain, unauthorized workspace listing
  (`listWorkspaceFolders`, `packages/db/src/queries/folders.ts`) plus one bulk load of the
  subject's own grants and membership row — never a query per folder, never a query per level.
- The ARIA tree view pattern is implemented directly (not a library): roving tabindex, arrow-key
  traversal (including expand/collapse and moving into/out of a node), Home/End, and type-ahead.
  See `apps/web/components/library/folder-tree/folder-tree.tsx`.
- Drag-and-drop uses native HTML5 DnD (no added dependency) and is desktop-only — mobile uses a
  drill-down list instead (per `docs/DESIGN.md`'s own split for this task, "visible on wide
  screens and drill-down on mobile"), so there is nothing to drag there in the first place. The
  keyboard-accessible equivalent is a "Move to…" command, reachable from the context menu (desktop)
  or the overflow menu (mobile) on every folder a viewer may edit — the same `moveFolderAction`
  server action the drop handler calls, not a separate code path.
- Move is transactional across the subtree via the existing `folders_after_move` trigger (task
  `021`) — nothing in this task's own code walks descendants. A move into a folder's own
  descendant is refused with a plain `conflict` before the database's own cycle check would ever
  fire, using the materialized path (`isSelfOrDescendant`, `apps/web/lib/library/tree.ts`).
- **Security-relevant design point, not in the original notes.** An ancestor folder that is not
  independently visible to a subject (a scope-limited collaborator's real ancestors, or a folder
  hidden by a `permission_grants` deny) never appears anywhere in the UI, including as a named
  breadcrumb — `breadcrumbFor` (`apps/web/lib/library/tree.ts`) stops at the first ancestor id
  missing from the authorized folder list, and `buildForest` treats such a folder as a root of its
  own rather than inventing a stub parent for it. Showing its name in a breadcrumb, even without a
  link, would be exactly the "folder's mere existence is information" leak this task's own
  Security/privacy section names.

**Two findings from the required security and test-coverage reviews, both fixed before this task
was marked complete:**

1. **The data itself, not just the list, was leaking invisible ancestors.** `readLibraryTree`
   correctly removed every invisible folder's own _row_, but each surviving row's `path` and
   `parentId` were the true, unfiltered database values — every real ancestor id up to the
   workspace root, invisible ones included, was still reaching the browser inside a visible
   folder's own fields (in the page's RSC payload, since both were passed straight into a
   `'use client'` component's props). A scope-limited collaborator granted a folder two levels
   under a root they never see would have had both ancestor ids handed to them regardless of
   neither ever appearing as its own row — the exact leak this task's own Security/privacy note
   names, just through a different door than the one `breadcrumbFor`/`buildForest` already guard.
   Fixed by `sanitizeFolderPaths` (`apps/web/lib/library/tree.ts`), which rewrites every folder's
   `path` and `parentId` to name only its own visible ancestors before `readLibraryTree` ever
   returns — the one point where the result crosses into a client component's props. A dedicated
   real-database test (`apps/web/lib/library/__tests__/folders.test.ts`, "never names an invisible
   ancestor…") and a pure unit suite (`apps/web/lib/library/__tests__/tree.test.ts`) both pin it.
2. **Folder/parent ids crossed the Server Action boundary unvalidated.** `name` was already
   Zod-validated in `apps/web/app/(workspace)/library/actions.ts`; `folderId`/`parentId`/
   `newParentId` were plain, unchecked strings — the same trust boundary
   `docs/THREAT_MODEL.md` requires Zod at everywhere else. Not an authorization bypass (every
   write still re-resolves the id through `assertMayEdit`/`getFolder`), but a bug regardless.
   Fixed by validating each with `folderIdSchema` (`@youandfriends/contracts`) before any of the
   four actions call into `lib/library/folders.ts`.

The test-coverage review separately found two real gaps, both closed: `renameLibraryFolder` and
`deleteLibraryFolder` had no negative-permission test (a viewer or an unrelated scope-limited
collaborator refused) — removing their `assertMayEdit` call would have passed every test in the
file — and the "Move to…" dialog, the "New folder"/"Rename" dialog, and the mobile drill-down list
had no tests at all. Both are closed: `apps/web/lib/library/__tests__/folders.test.ts` gained the
missing negative cases (and two existing assertions were strengthened from "threw _something_" to
checking the actual `publicCode`), and `apps/web/components/library/__tests__/` gained
`name-dialog.test.tsx`, `move-to-dialog.test.tsx`, and `mobile-drilldown.test.tsx` — all three are
plain Radix `Dialog`/list components with no right-click or long-press to simulate, unlike
`folder-tree.tsx`'s context menu, so they carry no task-`016` carve-out.

## Security/privacy considerations

Authorization filtering at the query layer is the control here. A folder's mere existence is information — an inaccessible folder must not appear as a greyed-out row. Move and delete are audited.

## Acceptance criteria

- [x] The tree renders nested folders filtered by authorization at the query layer.
- [x] Inaccessible folders are absent from the response payload, verified by inspecting the network response. (`apps/web/app/(workspace)/library/__tests__/page.test.tsx`'s 404 case, plus `loadVisibleFolders`'s real-database tests, prove no other folder is ever fetched or rendered as its own row — and, per the security-review finding above, `sanitizeFolderPaths` now ensures no _other_ folder's id is named inside a visible folder's own `path`/`parentId` either.)
- [x] Expand/collapse persists per user. (`localStorage`, per the `SplitPane` precedent — see deviation above.)
- [x] Full keyboard navigation follows the ARIA tree pattern.
- [x] Create, rename, move, and delete work; move updates the whole subtree.
- [x] Drag-to-move has a keyboard-accessible alternative.
- [x] Breadcrumbs reflect the current path.

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

`complete`

## Commit

`e884a5b`
