# 092 — Lyric-anchored comments

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Let comments attach to a lyric selection, block, or line, with anchors that survive edits and a clear visual indication in the editor.

## User value

Discussing one specific line without quoting it and hoping everyone finds it.

## Scope

- Commenting on a selected range, a block, or a line.
- Anchors that survive edits to surrounding text.
- Visual highlight of commented ranges in the editor.
- Clicking a comment scrolls to and highlights its anchor; clicking an anchor opens its thread.
- Orphaned-anchor handling when the anchored text is deleted — the comment survives and is marked orphaned rather than vanishing.
- Read-only anchor display for viewers.

## Non-scope

- Suggesting edits or tracked changes.
- Anchors spanning multiple blocks.
- Realtime anchor updates during collaborative editing beyond Yjs's own relative positions.

## Dependencies

`090`, `081`, `082`

## Files expected to change

```
apps/web/components/comments/lyric-anchor/**
apps/web/lib/lyrics/anchors.ts
apps/web/components/comments/__tests__/lyric-anchor.test.tsx
```

## Implementation notes

- Use **Yjs relative positions** for anchors. They are designed exactly for this and survive concurrent edits; character offsets do not survive a single edit above the anchor.
- Deleted anchor text must not delete the comment. Mark it orphaned and keep it in the thread list with its original quoted text, or people lose conversations by editing a line.
- Store the anchored text alongside the anchor so an orphaned comment can still show what it referred to.
- Highlight must be subtle. A lyric sheet with several commented ranges should remain readable — this is a writing surface first.
- Anchors need an accessible representation: a screen reader user must be able to discover that a line has comments.

## Security/privacy considerations

Comments on lyrics carry lyric content in their quoted text, inheriting asset-priority-2 sensitivity. The same authorization applies to the comment and its anchored quote.

## Acceptance criteria

- [x] Comments anchor to a selection, block, or line. ("Comment on the selection / this line / this section" under the lyrics; the range is taken at the press.)
- [x] Anchors use Yjs relative positions and survive edits above them, proven by test. (`lib/lyrics/anchors.ts`, from the editor's own Yjs binding. Tested through typing, new lines and a new section above, another person's concurrent edits made offline, and a save through the plain-document API.)
- [x] Commented ranges are subtly highlighted without harming readability. (A dotted underline and a 7% accent tint; stronger only for the thread being looked at.)
- [x] Clicking a comment scrolls to its anchor and vice versa. ("Show in the lyrics" selects and scrolls to the words and marks them; the marker after the words focuses and scrolls to the thread.)
- [x] Deleting anchored text orphans the comment rather than destroying it, preserving the quoted text. (The thread stays, with its quote and "The words this was about have been removed from the lyrics.")
- [x] Anchors are discoverable by assistive technology. (Each commented range ends with a real button — "Comment by Sam on “second line”, 1 reply" — in the text flow; the tint alone would be invisible to a screen reader.)
- [x] Viewers see anchors read-only. (Markers and highlights render in a read-only editor; viewers get no way to start a comment.)

**An architectural change this required.** Anchors need the words to keep their Yjs identity across every save. So every lyrics editor now edits a Yjs document — a local one when there is no room — and every save carries Yjs state for the server to merge; a save through the plain API is applied as an _edit_ of the stored Yjs state rather than replacing it. ADR 0011 is amended accordingly. Single-player autosave therefore no longer produces version conflicts (the conflict path remains for older clients).

**Not verified here.** Manual QA 1–3 need a browser and a screen reader (task `120`/`121`).

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Comment on a line, edit text above it, confirm the anchor holds.
2. Delete an anchored line and confirm the comment survives as orphaned with its quote.
3. Navigate anchors with a screen reader.

## Rollback/compatibility

Additive. Reverting loses lyric anchoring; comments remain as general threads.

## Status

`complete`

## Commit

`6e74861`
