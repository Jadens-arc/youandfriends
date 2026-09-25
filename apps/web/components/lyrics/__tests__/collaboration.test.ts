import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createRelay } from '@/lib/lyrics/__tests__/relay';
import type { CollaborationSession } from '@/lib/lyrics/collaboration-client';
import { lyricsToText, textToLyrics } from '@/lib/lyrics/text-format';
import { documentFromYjs, LYRICS_FRAGMENT, mergeYjs, yjsFromDocument } from '@/lib/lyrics/yjs';

import { fromEditorContent, lyricsSchemaExtensions } from '../editor/schema';

// jsdom has no layout; ProseMirror's scroll-into-view asks ranges for rectangles.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

const SEED = yjsFromDocument(textToLyrics('[Verse]\nHeadlights on\n[Chorus]\nStay, stay'));

const open: { editor: Editor; session: CollaborationSession }[] = [];

/** A person with the lyrics open: their own Y.Doc, seeded from Postgres, joined to the room. */
function person(relay: ReturnType<typeof createRelay>, name: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, SEED);
  const session = relay.factory('lyrics:TEST', doc);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      ...lyricsSchemaExtensions,
      Collaboration.configure({ document: doc, field: LYRICS_FRAGMENT }),
      CollaborationCaret.configure({
        provider: { awareness: session.awareness },
        user: { name, color: 'var(--color-olive-text)' },
      }),
    ],
  });
  open.push({ editor, session });
  const text = () => lyricsToText(fromEditorContent(editor.getJSON()));
  /** Type at the end of line `line` of section `section`. */
  const typeAt = (section: number, line: number, words: string) => {
    let pos = 0;
    for (let i = 0; i < section; i += 1) pos += editor.state.doc.child(i).nodeSize;
    const sectionNode = editor.state.doc.child(section);
    pos += 1;
    for (let i = 0; i < line; i += 1) pos += sectionNode.child(i).nodeSize;
    pos += 1 + sectionNode.child(line).content.size;
    editor.chain().setTextSelection(pos).insertContent(words).run();
  };
  return { doc, editor, session, text, typeAt };
}

afterEach(() => {
  for (const { editor, session } of open.splice(0)) {
    editor.destroy();
    session.destroy();
  }
});

describe('editing lyrics together (task 082)', () => {
  it('starts two people from one copy of the stored lyrics, not two', () => {
    const relay = createRelay();
    const sam = person(relay, 'Sam');
    const alex = person(relay, 'Alex');
    expect(sam.text()).toBe('[Verse]\nHeadlights on\n\n[Chorus]\nStay, stay');
    expect(alex.text()).toBe(sam.text());
  });

  it('converges when two people type at once, losing nothing', () => {
    const relay = createRelay();
    const sam = person(relay, 'Sam');
    const alex = person(relay, 'Alex');
    sam.typeAt(0, 0, ' — Sam');
    alex.typeAt(0, 0, ' — Alex');
    alex.typeAt(1, 0, ' (Alex)');
    sam.editor.commands.insertSection('bridge');
    sam.editor.commands.insertContent('Sam’s bridge');
    expect(sam.text()).toBe(alex.text());
    for (const words of ['— Sam', '— Alex', '(Alex)', 'Sam’s bridge', 'Headlights on']) {
      expect(sam.text()).toContain(words);
    }
  });

  it('merges cleanly after a real disconnection, with both sides typing meanwhile', () => {
    const relay = createRelay();
    const sam = person(relay, 'Sam');
    const alex = person(relay, 'Alex');
    relay.disconnect(alex.doc);
    sam.typeAt(0, 0, ' while you were gone');
    alex.typeAt(1, 0, ' typed offline');
    alex.editor.commands.duplicateSection();
    // Nothing crossed while apart.
    expect(sam.text()).not.toContain('typed offline');
    expect(alex.text()).not.toContain('while you were gone');

    relay.reconnect(alex.doc);
    expect(alex.text()).toBe(sam.text());
    expect(sam.text()).toContain('while you were gone');
    expect(sam.text().match(/typed offline/g)).toHaveLength(2);
  });

  it('saves from each side merge in Postgres to the same converged document', () => {
    const relay = createRelay();
    const sam = person(relay, 'Sam');
    const alex = person(relay, 'Alex');
    relay.disconnect(alex.doc);
    sam.typeAt(0, 0, ' — Sam');
    alex.typeAt(0, 0, ' — Alex');
    // Each saves only what it has; the server merges whatever arrives, in whatever order.
    const stored = mergeYjs(SEED, Y.encodeStateAsUpdate(alex.doc), Y.encodeStateAsUpdate(sam.doc));
    relay.reconnect(alex.doc);
    expect(lyricsToText(documentFromYjs(stored))).toBe(sam.text());
  });

  it('shows each collaborator’s cursor with their name', async () => {
    const relay = createRelay();
    const sam = person(relay, 'Sam');
    const alex = person(relay, 'Alex');
    // A cursor is shared only while its editor has focus, as in a browser.
    const host = alex.editor.view.dom;
    document.body.append(host.parentElement ?? host);
    // jsdom focuses only elements with a tab index; a browser focuses contenteditable as is.
    host.tabIndex = 0;
    host.focus();
    alex.editor.commands.setTextSelection(3);
    // y-prosemirror batches awareness redraws onto the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const labels = Array.from(sam.editor.view.dom.querySelectorAll('.collaboration-carets__label'));
    expect(labels.map((label) => label.textContent)).toContain('Alex');
    expect(sam.session.awareness.getStates().size).toBe(2);
  });
});
