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

- [ ] Comments anchor to a selection, block, or line.
- [ ] Anchors use Yjs relative positions and survive edits above them, proven by test.
- [ ] Commented ranges are subtly highlighted without harming readability.
- [ ] Clicking a comment scrolls to its anchor and vice versa.
- [ ] Deleting anchored text orphans the comment rather than destroying it, preserving the quoted text.
- [ ] Anchors are discoverable by assistive technology.
- [ ] Viewers see anchors read-only.

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

`pending`

## Commit

_(not yet)_
