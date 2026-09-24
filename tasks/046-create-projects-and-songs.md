# 046 — Create projects and songs

**Phase:** Library navigation · **Iteration:** one

## Objective

Let editors create a project (name, optional artist, filed at the root or in a folder they may
edit) and create songs inside a project they may edit.

## User value

The library can be filled from the product itself. Until this lands, a new workspace has folders
but no way to start the first project or the first song, so nothing upload-shaped has anywhere to
go.

## Why this exists

Added during implementation. The plan navigates folder → project → song (tasks `040`–`042`) and
uploads into songs and projects (phase 5), but no task creates either. Task `055`'s first-run
call to action and every "upload a mix" path need a song to land in, so this lands before `055`.

## Scope

- `POST /api/projects` — name, optional artist, optional folder; authorized as `edit` on the
  folder, or editor-or-better at the workspace root (the same rule as creating a root folder).
- `POST /api/projects/:projectId/songs` — title; authorized as `edit` on the project.
- "New project" on the library shelf, offered only where the viewer may create one.
- "New song" on the project page, offered only to editors.
- Audit events `project.created` and `song.created`, and both as collaborator activity.

## Non-scope

- Editing metadata after creation (task `043`).
- Deleting projects and songs (task `025` built the lifecycle; the trash UI is deferred `212`).
- Creating a song implicitly from an upload (task `055` composes these endpoints).

## Dependencies

`041`, `042`, `024`

## Files expected to change

```
packages/contracts/src/library.ts
packages/contracts/src/audit.ts
packages/db/migrations/0011_*.sql
apps/web/lib/library/create.ts
apps/web/app/api/projects/**
apps/web/components/library/new-project.tsx
apps/web/components/song/new-song.tsx
```

## Implementation notes

- Validation is one Zod schema shared by the dialog and the route.
- A project created inside a folder must land in a folder the viewer can edit, re-checked
  server-side; the folder id from the client is untrusted.
- New audit actions need `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction that
  also uses the value — nothing writes them in the migration itself.

## Security/privacy considerations

`docs/THREAT_MODEL.md` T1: a folder or project id from another workspace, or one the viewer
cannot edit, is refused 404-shaped. Names are user input rendered to collaborators — React's
escaping only, no raw HTML.

## Acceptance criteria

- [x] An editor can create a project at the root or in a folder they may edit. (`lib/library/__tests__/create.test.ts`; "New project" on the library shelf and in the first-run state, shown only where the page's server-side tree says the viewer may create.)
- [x] An editor can create a song in a project they may edit. ("New song" on the project page for editors.)
- [x] Viewers, commenters, and other workspaces are refused 404-shaped. (A folder-level deny on an editor, a commenter at the root, a foreign folder, a foreign project, a malformed id.)
- [x] Validation is shared between the dialogs and the routes. (`packages/contracts/src/library.ts`; `components/library/__tests__/create-dialogs.test.tsx` shows the schema's own message with no request sent.)
- [x] Creation is audited and appears as collaborator activity. (`project.created` and `song.created`, migration `0011`; both added to `CONTENT_ACTIVITY_ACTIONS` with the verb "started".)

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/contracts test
pnpm release-check
```

## Manual QA

1. On an empty workspace, create a project from the library, then a song in it.
2. As a viewer, confirm neither control appears and the routes refuse.

## Rollback/compatibility

Additive: two routes, two dialogs, two enum values.

## Status

`complete`

## Commit

`1e5bfe5`
