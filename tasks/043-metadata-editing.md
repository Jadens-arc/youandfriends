# 043 — Song and project metadata editing

**Phase:** Library navigation · **Iteration:** one

## Objective

Let editors change song and project metadata — title, artist, status, cover art, notes — with optimistic updates, validation, and audit.

## User value

Keeping the library accurate without leaving the page you are working in.

## Scope

- Inline editing for song title, artist, status, and notes.
- Project name, artist, status, and cover art upload.
- Zod validation shared between client and server via `packages/contracts`.
- Optimistic updates with rollback on failure and a clear error.
- Editor-role enforcement: viewers and commenters see read-only affordances, not disabled-looking controls that imply a missing permission.
- Audit events for metadata changes.

## Non-scope

- Bulk editing.
- Cover art cropping or image editing beyond upload and fit.
- Custom user-defined metadata fields.

## Dependencies

`042`, `024`

## Files expected to change

```
apps/web/components/song/metadata/**
apps/web/app/api/songs/[songId]/route.ts
packages/contracts/src/songs.ts
apps/web/components/song/metadata/__tests__/**
```

## Implementation notes

- Share the Zod schema across client and server so validation cannot diverge — that is precisely why `packages/contracts` exists.
- Optimistic update rollback must restore the exact prior value and say what failed. A silent revert reads as the app eating input.
- For viewers, render plain text rather than a disabled input. A disabled field advertises a capability they do not have and invites confusion.
- Cover art upload reuses the phase 5 upload path rather than introducing a second mechanism — if this task lands first, gate the art upload behind task `056`.
- Metadata changes emit notification events (phase 9); define the event now even though delivery arrives later.

## Security/privacy considerations

Metadata is user input rendered back to other users — sanitize on output and rely on React's escaping rather than any `dangerouslySetInnerHTML`. Every mutation runs `assertCan(subject, 'edit', target)`. Changes are audited with before and after values, with the redaction deny-list applied.

## Acceptance criteria

- [ ] Song and project metadata are editable inline by editors.
- [ ] Validation is shared between client and server.
- [ ] Optimistic updates roll back correctly and explain failures.
- [ ] Viewers and commenters see read-only presentation, not disabled inputs.
- [ ] Every mutation is authorized and audited.
- [ ] Cover art upload works through the standard upload path.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/contracts test
```

## Manual QA

1. Edit a title as an editor; confirm it persists.
2. Force a server error and confirm the optimistic value rolls back with a clear message.
3. View as a commenter and confirm read-only presentation.

## Rollback/compatibility

Additive. Reverting loses editing; data is unaffected.

## Status

`pending`

## Commit

_(not yet)_
