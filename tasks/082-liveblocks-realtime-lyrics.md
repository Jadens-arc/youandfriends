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

- [x] Two users editing simultaneously converge without lost text. (Two real Tiptap editors on their own Yjs documents converge through concurrent typing and restructuring — `components/lyrics/__tests__/collaboration.test.ts`. Persistence converges too: collaborative saves carry Yjs state that the server **merges** (ADR 0011), in any order or twice, re-deriving the document through the lyrics schema — `lib/lyrics/__tests__/collaboration.test.ts`.)
- [x] Room tokens are minted server-side after an authz check, scoped to one room and role. (`POST /api/liveblocks/auth` → `roomAccess` → `mintRoomToken`: one room, `room:write` for editors, `room:read` + own presence otherwise; 404-shaped for strangers, other workspaces, trashed songs, and non-lyrics rooms. Tested through the route and the service.)
- [x] Viewers and commenters cannot write to the document. (Read-only room tokens; the editor is not editable and shows no section controls; the save path refuses them — tested.)
- [x] Presence and cursors show names and colors. (`CollaborationCaret` with a name label on every cursor, and a "Also here" list with names in words beside a colour; colours from the palette, resolved from the tokens at runtime — tested with two editors.)
- [x] Reconnection after disconnect merges cleanly, tested with a real disconnection. (Through an in-memory room whose disconnection is genuine — nothing crosses in either direction while apart, then state-vector resync — with both sides typing and restructuring meanwhile; the editors converge and the server-side merge of each side's saves equals the converged document. **Not** tested against Liveblocks' own servers: there are no Liveblocks credentials in this environment; see below.)
- [x] Snapshots persist to Postgres on debounce and lifecycle events. (Collaborative editing uses task `080`'s autosave — idle debounce, blur, page hide, navigation — sending the shared Yjs state. Remote edits are saved by their author's tab, not re-saved by everyone's. A second path, the signed `ydocUpdated` webhook at `/api/webhooks/liveblocks`, merges the room's copy — tested with a delivery signed the way Liveblocks signs one and verified by the real `WebhookHandler`.)
- [x] Demotion mid-session revokes write access promptly, proven by test. (The next token is read-only; the next save is refused; an open editor re-checks its access every 30 s, on focus, and after any refused save, and on a change stops accepting input and rejoins read-only — each tested, and each mutation-checked. **Residual gap, recorded in `docs/THREAT_MODEL.md`:** Liveblocks cannot recall an already-issued token, so a _modified_ client could keep writing into the room until its token expires.)
- [x] Liveblocks unavailability degrades to single-player autosave with a visible state. (Without `LIVEBLOCKS_SECRET_KEY` the editor is single-player, exactly as in `080`/`081`. With it but unreachable, the editor keeps working on its local Yjs document and keeps saving to Postgres, saying "Working alone — live editing is unreachable, your changes still save" — tested.)
- [x] Presence announcements do not flood assistive technology. (A polite live region says who joined or left; cursor movement, which changes awareness constantly, announces nothing and does not re-render the list — tested. Cursors themselves are `aria-hidden`.)

**Decisions recorded.** ADR 0011 (collaborative saves merge Yjs state; deterministic seeds; single-player saves clear stale Yjs state). `LIVEBLOCKS_WEBHOOK_SECRET` added to the environment schema and `.env.example`. T6 in `docs/THREAT_MODEL.md` rewritten to what is actually enforced.

**Not verified here.** No Liveblocks credentials exist in this environment, so the real transport (`liveblocksSession`, the SDK's token call, and the REST fetch in the webhook) is implemented behind configuration and exercised only with the SDK's REST client substituted; Manual QA 1–4 need two browsers and a Liveblocks project (task `120`).

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

`complete`

## Commit

_(not yet)_
