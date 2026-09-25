import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import {
  lyricsDocumentSchema,
  lyricsPlainText,
  type LyricsDocument,
} from '@youandfriends/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanPastedText,
  fromEditorContent,
  insertPastedText,
  lyricsExtensions,
  toEditorContent,
} from '../editor/schema';
import { lyricsToText, textToLyrics } from '@/lib/lyrics/text-format';

const SHEET = `[Verse]
Headlights on
[Chorus]
Stay, stay
[Verse]
Tail lights
[Bridge]
Slow down`;

let editor: Editor | null = null;

function open(text = SHEET): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: lyricsExtensions,
    content: toEditorContent(textToLyrics(text)),
  });
  return editor;
}

/** The editor's document as it would be saved — and proof it would pass the contract. */
function saved(target: Editor): LyricsDocument {
  const document = fromEditorContent(target.getJSON());
  return lyricsDocumentSchema.parse(document);
}

function text(target: Editor): string {
  return lyricsToText(saved(target));
}

/** Headings as drawn on the page, from the heading decorations. */
function headings(target: Editor): string[] {
  return Array.from(target.view.dom.querySelectorAll('.lyrics-section-heading')).map(
    (node) => node.textContent ?? '',
  );
}

/** Put the cursor inside the section at `index`. */
function into(target: Editor, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += target.state.doc.child(i).nodeSize;
  target.commands.setTextSelection(pos + 2);
}

function paste(target: Editor, data: Record<string, string>) {
  const event = { clipboardData: { getData: (type: string) => data[type] ?? '' } };
  return target.view.someProp('handlePaste', (handler) =>
    handler(target.view, event as unknown as ClipboardEvent, Slice.empty),
  );
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the lyrics editor schema (task 081)', () => {
  it('draws derived headings, numbering repeated kinds by order', () => {
    const target = open();
    expect(headings(target)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Bridge']);
    expect(saved(target).content.map((section) => section.attrs.label ?? null)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('renumbers on reorder, and moves the whole section with the cursor', () => {
    const target = open();
    into(target, 2);
    expect(target.commands.moveSection(-1)).toBe(true);
    expect(target.commands.moveSection(-1)).toBe(true);
    expect(headings(target)).toEqual(['Verse 1', 'Verse 2', 'Chorus', 'Bridge']);
    expect(text(target)).toMatch(/^\[Verse 1\]\nTail lights\n\n\[Verse 2\]\nHeadlights on/);
    // At the top, "up" is refused rather than wrapping.
    expect(target.commands.moveSection(-1)).toBe(false);
  });

  it('creates, duplicates, renames, retypes, and deletes sections', () => {
    const target = open('[Verse]\nHeadlights on');
    target.commands.insertSection('chorus');
    target.commands.insertContent('Stay, stay');
    expect(headings(target)).toEqual(['Verse', 'Chorus']);

    target.commands.duplicateSection();
    expect(headings(target)).toEqual(['Verse', 'Chorus 1', 'Chorus 2']);

    target.commands.renameSection('  Last   chorus ');
    expect(headings(target)).toEqual(['Verse', 'Chorus', 'Last chorus']);
    target.commands.renameSection('');
    expect(headings(target)).toEqual(['Verse', 'Chorus 1', 'Chorus 2']);

    target.commands.setSectionKind('outro');
    expect(headings(target)).toEqual(['Verse', 'Chorus', 'Outro']);

    target.commands.deleteSection();
    expect(text(target)).toBe('[Verse]\nHeadlights on\n\n[Chorus]\nStay, stay');
  });

  it('keeps a section to type into when the last one is deleted, and saves that as no lyrics', () => {
    const target = open('[Bridge]\nonly');
    target.commands.deleteSection();
    expect(headings(target)).toEqual(['Verse']);
    expect(saved(target)).toEqual({ type: 'doc', content: [] });
  });

  it('does not copy timestamps onto a duplicate', () => {
    const target = open('[Chorus]\nStay');
    target.commands.command(({ tr }) => {
      tr.setNodeAttribute(0, 'timestampMs', 42_000);
      return true;
    });
    target.commands.duplicateSection();
    expect(saved(target).content.map((section) => section.attrs.timestampMs ?? null)).toEqual([
      42_000,
      null,
    ]);
  });

  it('moves between sections with goToSection', () => {
    const target = open();
    into(target, 0);
    target.commands.goToSection(1);
    target.commands.insertContent('X');
    expect(text(target)).toContain('[Chorus]\nXStay, stay');
    expect(target.commands.goToSection(-1)).toBe(true);
    expect(target.commands.goToSection(-1)).toBe(false);
  });

  it('pastes plain lines at the cursor, split into lines', () => {
    const target = open('[Verse]\n');
    into(target, 0);
    insertPastedText(target.view, 'one\ntwo\r\nthree');
    expect(text(target)).toBe('[Verse]\none\ntwo\nthree');
  });

  it('pastes bracketed text as sections, replacing an empty one', () => {
    const target = open('[Verse]\n');
    into(target, 0);
    insertPastedText(target.view, '[Chorus]\nStay\n\n[Hook]\nla la');
    expect(headings(target)).toEqual(['Chorus', 'Hook']);
    expect(lyricsPlainText(saved(target))).toBe('Chorus\nStay\n\nHook\nla la');
  });

  it('reads text/plain only — markup on the clipboard never reaches the document', () => {
    const target = open('[Verse]\n');
    into(target, 0);
    const handled = paste(target, {
      'text/html': '<h1 style="color:red">Big</h1><img src=x onerror=alert(1)><script>x()</script>',
      'text/plain': 'Big',
    });
    expect(handled).toBe(true);
    expect(text(target)).toBe('[Verse]\nBig');
    expect(JSON.stringify(target.getJSON())).not.toMatch(/img|script|style|h1/);
  });

  it('strips control characters and direction overrides from pasted text', () => {
    const nul = String.fromCharCode(0);
    const rlo = String.fromCharCode(0x202e);
    expect(cleanPastedText(`a${nul}b${rlo}c\td`)).toBe('abc\td');
    const target = open('[Verse]\n');
    into(target, 0);
    insertPastedText(target.view, `clean${rlo}ed`);
    expect(text(target)).toBe('[Verse]\ncleaned');
  });

  it('cuts an over-long pasted line so the document still saves', () => {
    const target = open('[Verse]\n');
    into(target, 0);
    insertPastedText(target.view, 'x'.repeat(5_000));
    expect(() => saved(target)).not.toThrow();
  });

  it('rejects content the schema does not know, even when set directly', () => {
    const target = open('[Verse]\n');
    target.commands.setContent('<p>para</p><ul><li>list</li></ul><a href="x">link</a>');
    const types = new Set<string>();
    target.state.doc.descendants((node) => {
      types.add(node.type.name);
      for (const mark of node.marks) types.add(`mark:${mark.type.name}`);
    });
    expect([...types].sort()).toEqual(['lyricsLine', 'lyricsSection', 'text']);
    expect(JSON.stringify(target.getJSON())).not.toMatch(/href/);
    expect(() => saved(target)).not.toThrow();
  });

  it('copies a whole-section selection as bracketed text, and lines as lines', () => {
    const target = open();
    const serialize = (from: number, to: number) =>
      target.view.someProp('clipboardTextSerializer', (fn) =>
        fn(target.state.doc.slice(from, to), target.view),
      );
    expect(serialize(0, target.state.doc.content.size)).toBe(lyricsToText(saved(target)));
    const first = target.state.doc.child(0);
    expect(serialize(2, first.nodeSize - 2)).toBe('Headlights on');
  });
});
