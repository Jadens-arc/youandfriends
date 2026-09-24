# ADR 0011: Collaborative lyrics saves merge Yjs state

- **Status:** accepted
- **Date:** 2026-09-24
- **Task:** 082

## Context

Task `080` protects single-player lyrics with a version counter: a save names the version it
started from, and anything else is a conflict. With several people editing one Yjs document
through a Liveblocks room (ADR 0003), every open editor holds the same merged document and
autosaves it. A version check would turn every save after the first into a "conflict" that is not
one, and last-writer-wins would let a tab that has not yet received someone's words overwrite
them in Postgres.

A second problem sits at the start of a session: two people opening lyrics that were never
edited together would each convert the stored JSON into Yjs independently, producing two copies
of every line when their documents meet.

## Decision

- **Collaborative saves carry Yjs state, and the server merges it** (`Y.mergeUpdates`) into the
  Yjs state stored beside the canonical JSON. The document is then **derived from the merged
  state** through the lyrics schema — never taken from the request — and validated against the
  contract. There is no version check on this path: merging is commutative and idempotent, so
  saves may arrive in any order, or twice.
- **Seeds are deterministic.** Lyrics with no stored Yjs state are converted by a Yjs client with
  id 0, so every conversion of the same document is byte-identical and merges into one copy.
- **A single-player save clears the stored Yjs state**, which would otherwise describe an older
  document.
- The Liveblocks `ydocUpdated` webhook merges the room's copy by the same function — a second
  path, only into a row an editor already created.

## Consequences

**Easier:** No false conflicts; no lost words when saves cross; a tab that reconnects after
working offline simply saves and merges.

**Harder:** Postgres stores the Yjs history (tombstones included), which grows with editing.
Fine at lyric-sheet sizes; revisions (task `084`) are where compaction would go.

**Accepted:** Toggling collaboration off and back on while a room still holds an old document
can reintroduce text from that room. Collaboration is a deployment setting, not a per-song
switch, so this is an operator action, noted here rather than engineered around.

## Assumptions to re-verify

- `y-prosemirror` drops nodes outside the schema when reading a fragment (tested).
- Yjs state for a long lyric sheet stays in the kilobytes-to-low-megabytes range; the save
  contract bounds an incoming state at 2 MB of base64.

## Alternatives considered

**Keep the version check and auto-rebase on conflict.** Every save would be a retry loop, and a
tab missing someone's latest words would still overwrite them.

**Persist only from the webhook.** ADR 0003 already rejects depending on the webhook alone.
