# 082 — Real-time collaboration, presence, and cursors

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Add conflict-safe real-time collaborative editing via Yjs over Liveblocks, with presence, collaborator cursors, and correct handling of permission changes mid-session.

## User value

Writing a chorus together, from different cities, without overwriting each other.

## Scope

- Yjs document bound to the Tiptap editor, synchronized through a Liveblocks room per song.
- Server-side room authorization at `/api/liveblocks/auth` using the standard `authz` check.
- Role-appropriate room capabilities: editors write, commenters and viewers observe read-only.
- Presence indicators and collaborator cursors with names and colors.
- Reconnection handling that merges cleanly after disconnection.
- Snapshot persistence to Postgres on debounce and on lifecycle events, plus a webhook path.
- Permission change mid-session revoking write access promptly.

## Non-scope

- The editor (task `081`), revisions (task `084`).
- Realtime for comments — comments are request/response.
- Offline queued edits (deferred `204`).

## Dependencies

`081`, `080`, `023`

## Files expected to change

```
apps/web/app/api/liveblocks/auth/route.ts
apps/web/lib/lyrics/collaboration.ts
apps/web/components/lyrics/presence/**
apps/web/lib/lyrics/__tests__/**
```

## Implementation notes

- Room tokens are minted **server-side only**, after the same `assertCan` check as any other route (T6). Never let a client assert its own room or role.
- Tokens are short-lived so demotion takes effect on renewal. A collaborator demoted from editor to viewer must lose write access promptly — test this explicitly.
- Postgres remains canonical (ADR 0003). If Liveblocks is unavailable, degrade to single-player autosave with a visible offline state rather than blocking writing.
- Do not depend on the webhook alone for persistence — the client also persists on debounce, so a missed webhook loses nothing.
- Presence must not overwhelm assistive technology (`docs/DESIGN.md` §12). Announce joins and leaves politely, not every cursor movement.
- Test reconnect after a genuine disconnection, not just a simulated one. Yjs merges correctly, but the binding and the save path around it are where bugs live.

## Security/privacy considerations

Room access is a T6 control. Authorization is server-side, per room, role-scoped, with short-lived tokens. Lyrics are asset priority 2 — a user who cannot read a song must not be able to join its room, and this gets an explicit negative test in the task `023` suite.

## Acceptance criteria

- [ ] Two users editing simultaneously converge without lost text.
- [ ] Room tokens are minted server-side after an authz check, scoped to one room and role.
- [ ] Viewers and commenters cannot write to the document.
- [ ] Presence and cursors show names and colors.
- [ ] Reconnection after disconnect merges cleanly, tested with a real disconnection.
- [ ] Snapshots persist to Postgres on debounce and lifecycle events.
- [ ] Demotion mid-session revokes write access promptly, proven by test.
- [ ] Liveblocks unavailability degrades to single-player autosave with a visible state.
- [ ] Presence announcements do not flood assistive technology.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Edit the same lyrics from two browsers; confirm convergence and visible cursors.
2. Disconnect one browser, keep typing in both, reconnect, confirm a clean merge.
3. Demote a collaborator mid-session and confirm write access is lost.
4. Block the Liveblocks domain and confirm single-player autosave still works.

## Rollback/compatibility

Additive over task `080`'s canonical persistence. Reverting loses collaboration but not lyrics — which is exactly why Postgres is canonical.

## Status

`pending`

## Commit

_(not yet)_
