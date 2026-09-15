# 081 — Tiptap structured lyrics editor

**Phase:** Collaborative lyrics · **Iteration:** one

## Objective

Build the lyrics editor with structured section blocks, typewriter-inspired typography, and a clean writing surface that stays comfortable for long sessions.

## User value

A place to write that feels like a notebook page rather than a form field, with the structure a song actually has.

## Scope

- Tiptap editor with custom section blocks: Verse, Pre-Chorus, Chorus, Bridge, Outro, and custom-named freeform sections.
- Block creation, reordering, renaming, duplication, and deletion.
- Monospace/typewriter typography with generous line height and a comfortable measure (task `011`).
- Keyboard shortcuts for block insertion and navigation.
- Side-by-side audio and lyrics on desktop (`docs/DESIGN.md` §6).
- Section numbering that updates automatically (Verse 1, Verse 2).

## Non-scope

- Realtime collaboration (task `082`), timestamps (task `083`), revisions (task `084`), mobile (task `085`).
- AI-assisted writing — an explicit product non-goal.
- Rich text formatting beyond structure; lyrics are text with structure, not a word processor.

## Dependencies

`080`, `011`

## Files expected to change

```
apps/web/components/lyrics/editor/**
apps/web/components/lyrics/blocks/**
apps/web/components/lyrics/__tests__/**
```

## Implementation notes

- Define the Tiptap schema deliberately and restrictively. An open schema allows paste of arbitrary HTML structure that the plain-text projection and timestamps cannot handle. Restrict nodes and marks to what the design specifies.
- Paste handling must strip formatting to plain text with structure inferred — pasting from a browser or document brings styling that breaks the typographic system and can carry markup.
- Section numbering is derived from order, not stored. Storing it means it goes stale on reorder.
- The writing surface matters more than the chrome here. Keep toolbars minimal and out of the way; this is the surface people spend the longest time in.
- Comfortable measure means limiting line length even on a wide screen — full-width lyrics are unpleasant to read and to write.

## Security/privacy considerations

Pasted content is untrusted input. The restricted Tiptap schema is the control: strip to plain text and structure, never accept arbitrary HTML. React escaping handles rendering, but the stored document must be clean, because it is also projected to plain text and rendered in search results and notifications.

## Acceptance criteria

- [ ] Section blocks for Verse, Pre-Chorus, Chorus, Bridge, Outro, and custom types exist.
- [ ] Blocks can be created, reordered, renamed, duplicated, and deleted.
- [ ] Typography uses the typewriter face with comfortable line height and measure.
- [ ] Keyboard shortcuts insert and navigate blocks.
- [ ] Desktop shows audio and lyrics side by side.
- [ ] Section numbering derives from order and updates on reorder.
- [ ] Pasted content is stripped to text and structure; arbitrary HTML is rejected.

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Write a full lyric sheet with several sections; judge comfort over a long session.
2. Paste formatted text from a web page and confirm it arrives clean.
3. Reorder verses and confirm numbering updates.

## Rollback/compatibility

UI only. Reverting loses the editor; stored lyrics remain intact.

## Status

`pending`

## Commit

_(not yet)_
