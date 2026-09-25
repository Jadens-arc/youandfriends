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

- [x] Section blocks for Verse, Pre-Chorus, Chorus, Bridge, Outro, and custom types exist. (Also Intro. A freeform section, or any section, can be given its own name. `components/lyrics/editor/schema.ts`.)
- [x] Blocks can be created, reordered, renamed, duplicated, and deleted. (The "Section" toolbar — Add section, type, Rename, Move up/down, Duplicate, Delete — acts on the section holding the cursor; every action is undoable. A duplicate does not inherit timestamps. Deleting the last section leaves an empty one to type into, which is saved as no lyrics.)
- [x] Typography uses the typewriter face with comfortable line height and measure. (`.font-lyric`: IBM Plex Mono, `--text-lyric` at 1.85 line height, `--container-lyric` 34 rem measure, centred on wide screens; headings in the editorial serif.)
- [x] Keyboard shortcuts insert and navigate blocks. (Mod-Enter new section; Mod-Alt-1…6 and 0 by kind; Alt-↑/↓ previous/next section; Mod-Shift-↑/↓ move; Mod-Shift-D duplicate; Backspace in an empty section deletes it. Listed under "Keyboard shortcuts" below the editor.)
- [x] Desktop shows audio and lyrics side by side. (`LyricsAudio` — the current playable version's play button, compact waveform and loop controls — in a sticky column beside the editor from `lg`; above it on narrower screens.)
- [x] Section numbering derives from order and updates on reorder. (`sectionHeadings` in `@youandfriends/contracts` numbers a kind only when it repeats and is drawn as decorations; nothing numbered is stored. The plain-text projection and the bracketed text format use the same function. Tested through a reorder.)
- [x] Pasted content is stripped to text and structure; arbitrary HTML is rejected. (Paste and external drops read `text/plain` only; `transformPastedHTML` returns nothing; control characters and bidi overrides are stripped and over-long lines cut to the contract's bound; bracketed headings become sections. The schema has three node types and no marks, so even `setContent` with HTML produces only sections, lines and text — tested.)

**Changed from `080`.** A section's `label` is now a name the writer gave it; "Verse 2" in bracketed text is read as a verse (the number derived), not as a label.

**Not verified here.** Manual QA 1–3 need a browser; none is available in this environment (task `120`). Editor tests run the real Tiptap editor in jsdom, with layout stubbed.

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

`complete`

## Commit

`5c6f80a`
