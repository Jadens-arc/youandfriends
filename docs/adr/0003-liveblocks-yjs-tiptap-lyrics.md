# ADR 0003: Tiptap + Yjs over Liveblocks for collaborative lyrics

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

Lyrics are a first-class collaborative document: structured blocks (Verse, Pre-Chorus,
Chorus, Bridge, Outro, custom), autosave, presence, collaborator cursors, conflict-safe
concurrent editing, optional timestamp anchors, anchored comments, and restorable revisions.

Conflict-free concurrent editing needs a CRDT. Presence and cursors need a persistent
bidirectional connection. Vercel's serverless functions cannot hold websockets open.

## Decision

**Tiptap** for the structured editor, **Yjs** as the CRDT, **Liveblocks** as the hosted Yjs
transport and presence layer. **Postgres is the canonical store.**

- Room per song: `lyrics:<songId>`.
- Room tokens are issued by `/api/liveblocks/auth`, which runs the same `packages/authz`
  check as any other route. A viewer gets read-only presence; a commenter cannot mutate the
  document; only an editor receives write access.
- Postgres stores three projections, written debounced on idle/blur/lifecycle:
  canonical Tiptap JSON, a plain-text projection for search, and the Yjs state vector.
- Revisions snapshot automatically on a cadence and on explicit user checkpoints, and are
  restorable.

The realtime layer is a **cache and transport, never the record**. If Liveblocks is
unavailable the editor degrades to single-player autosave against Postgres with a visible
"offline — changes saved locally" state, rather than blocking writing.

## Consequences

**Easier:** No websocket infrastructure to operate. Presence, cursors, and awareness are
solved. Tiptap's schema gives us real structured blocks rather than a textarea, which the
timestamp anchors and lyric-anchored comments depend on.

**Harder:** Permission changes mid-session must be propagated — a collaborator demoted from
editor to viewer while typing has to lose write access promptly. Task `082` tests exactly
this, along with reconnect behavior and simultaneous editing.

**Accepted:** A fourth vendor. Mitigated by Postgres holding canonical state, so a Liveblocks
outage or migration costs us presence, not lyrics.

## Assumptions to re-verify

- Liveblocks free tier MAU and concurrent-connection limits fit a private workspace.
- Yjs document size for a long lyric sheet stays well inside room payload limits.
- Liveblocks webhook delivery is reliable enough to trigger snapshot persistence; we do not
  depend on it alone — the client also persists on debounce, so a missed webhook loses
  nothing.

## Alternatives considered

**Self-hosted `y-websocket`** — no vendor and full control, but requires an always-on
container, and we would own reconnection, scaling, and auth plumbing.

**PartyKit / Cloudflare Durable Objects** — an elegant fit and close to R2, but more
infrastructure to write for iteration one and a less direct Tiptap integration.

**Operational transform (e.g. ShareDB)** — mature, but Yjs has the stronger modern editor
ecosystem and offline-merge story, which matters for the mobile offline requirement.
