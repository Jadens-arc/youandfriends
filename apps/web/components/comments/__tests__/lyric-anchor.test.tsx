import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createRelay } from '@/lib/lyrics/__tests__/relay';
import {
  anchorFromRange,
  rangeForScope,
  resolveAnchor,
  type LyricAnchor,
} from '@/lib/lyrics/anchors';
import { textToLyrics } from '@/lib/lyrics/text-format';
import { LYRICS_FRAGMENT, yjsFromDocument, yjsReplace } from '@/lib/lyrics/yjs';

import { lyricsSchemaExtensions } from '../../lyrics/editor/schema';
import { anchorStorage, commentAnchorsKey, LyricCommentAnchors } from '../lyric-anchor/extension';
import { anchorThreads, LyricComments } from '../lyric-anchor/lyric-comments';

const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

const SHEET = '[Verse]\nfirst line\nsecond line\n[Chorus]\nStay, stay';
const editors: Editor[] = [];

/** An editor bound to a Yjs document, as every lyrics editor now is. */
function open(doc = seeded(), editable = true) {
  const editor = new Editor({
    element: document.createElement('div'),
    editable,
    extensions: [
      ...lyricsSchemaExtensions,
      Collaboration.configure({ document: doc, field: LYRICS_FRAGMENT }),
      LyricCommentAnchors,
    ],
  });
  editors.push(editor);
  return editor;
}

function seeded(text = SHEET) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsFromDocument(textToLyrics(text)));
  return doc;
}

/** Put the cursor at the end of the line reading `text`. */
function cursorOn(editor: Editor, text: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'lyricsLine' && node.textContent === text) {
      found = pos + 1 + node.content.size;
    }
  });
  if (found === -1) throw new Error(`no line "${text}"`);
  editor.commands.setTextSelection(found);
}

function anchorLine(editor: Editor, text: string): LyricAnchor {
  cursorOn(editor, text);
  const range = rangeForScope(editor.state, 'line');
  const anchor = range === null ? null : anchorFromRange(editor.state, range, 'line');
  if (anchor === null) throw new Error('no anchor');
  return anchor;
}

const wordsAt = (editor: Editor, anchor: LyricAnchor) => {
  const range = resolveAnchor(editor.state, anchor);
  return range === null ? null : editor.state.doc.textBetween(range.from, range.to, '\n');
};

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.unstubAllGlobals();
});

describe('lyric anchors (task 092)', () => {
  it('anchors a selection, a line, or a section, keeping the words it quotes', () => {
    const editor = open();
    cursorOn(editor, 'second line');
    const section = anchorFromRange(
      editor.state,
      rangeForScope(editor.state, 'section')!,
      'section',
    );
    expect(section?.quote).toBe('first line\nsecond line');
    expect(rangeForScope(editor.state, 'selection')).toBeNull();
    editor.commands.setTextSelection({ from: 2, to: 7 });
    const selection = anchorFromRange(
      editor.state,
      rangeForScope(editor.state, 'selection')!,
      'selection',
    );
    expect(selection).toMatchObject({ quote: 'first', scope: 'selection' });
    // Yjs relative positions, not offsets: they name an item or a type, never a number.
    expect(typeof selection?.start).toBe('object');
    expect(
      Object.keys(selection?.start ?? {}).some((key) => ['item', 'type', 'tname'].includes(key)),
    ).toBe(true);
  });

  it('stays on its words through edits above and around them', () => {
    const editor = open();
    const anchor = anchorLine(editor, 'second line');
    cursorOn(editor, 'first line');
    editor.commands.insertContent(' — much longer now');
    editor.commands.splitBlock();
    editor.commands.insertContent('a whole new line above');
    editor.commands.insertSection('intro');
    editor.commands.insertContent('and a new intro');
    expect(wordsAt(editor, anchor)).toBe('second line');
  });

  it('stays on its words through someone else’s concurrent edits', () => {
    const relay = createRelay();
    const docA = seeded();
    const docB = seeded();
    const sessionA = relay.factory('lyrics:X', docA);
    const sessionB = relay.factory('lyrics:X', docB);
    const sam = open(docA);
    const alex = open(docB);
    const anchor = anchorLine(sam, 'second line');
    relay.disconnect(docB);
    cursorOn(alex, 'first line');
    alex.commands.splitBlock();
    alex.commands.insertContent('Alex added this, offline');
    relay.reconnect(docB);
    expect(wordsAt(sam, anchor)).toBe('second line');
    expect(wordsAt(alex, anchor)).toBe('second line');
    sessionA.destroy();
    sessionB.destroy();
  });

  it('stays on its words through a plain save, applied as an edit of the stored state', () => {
    const stored = yjsFromDocument(textToLyrics(SHEET));
    const editor = open(seeded());
    const anchor = anchorLine(editor, 'second line');
    // Someone saves through the plain API: a new line above, a changed first line.
    const { merged } = yjsReplace(
      stored,
      textToLyrics('[Verse]\nfirst line, revised\nnew\nsecond line\n[Chorus]\nStay, stay'),
    );
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, merged);
    expect(wordsAt(open(reopened), anchor)).toBe('second line');
  });

  it('orphans the anchor when its words are deleted — the comment and its quote remain', async () => {
    const editor = open();
    const anchor = anchorLine(editor, 'second line');
    cursorOn(editor, 'second line');
    const range = rangeForScope(editor.state, 'line')!;
    editor.commands.deleteRange(range);
    expect(resolveAnchor(editor.state, anchor)).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              canComment: true,
              threads: [
                {
                  id: 'T1',
                  anchor: { kind: 'lyric', ...anchor },
                  resolvedAt: null,
                  resolvedBy: null,
                  comments: [
                    {
                      id: 'C1',
                      author: 'Sam',
                      body: 'Cut this line?',
                      createdAt: '2026-09-24T10:00:00.000Z',
                      editedAt: null,
                      deleted: false,
                      canEdit: false,
                      canDelete: false,
                    },
                  ],
                },
              ],
            }),
          ),
      ),
    );
    render(<LyricComments songId="S-orphan" editor={editor} active={null} onShow={() => {}} />);
    await act(async () => {});
    expect(
      screen.getByText('The words this was about have been removed from the lyrics.'),
    ).toBeInTheDocument();
    expect(screen.getByText('second line', { selector: 'blockquote' })).toBeInTheDocument();
    expect(screen.getByText('Cut this line?')).toBeInTheDocument();
  });
});

describe('lyric anchors in the editor (task 092)', () => {
  const threadOn = (anchor: LyricAnchor) =>
    anchorThreads([
      {
        id: 'T1',
        anchor: { kind: 'lyric', ...anchor },
        resolvedAt: null,
        resolvedBy: null,
        comments: [
          {
            id: 'C1',
            author: 'Sam',
            body: 'Too wordy',
            createdAt: '2026-09-24T10:00:00.000Z',
            editedAt: null,
            deleted: false,
            canEdit: false,
            canDelete: false,
          },
          {
            id: 'C2',
            author: 'Alex',
            body: 'Agreed',
            createdAt: '2026-09-24T10:01:00.000Z',
            editedAt: null,
            deleted: false,
            canEdit: false,
            canDelete: false,
          },
        ],
      },
    ]);

  function mark(editor: Editor, anchor: LyricAnchor, onOpen = vi.fn()) {
    anchorStorage(editor).set(threadOn(anchor), null, onOpen);
    editor.view.dispatch(editor.state.tr.setMeta(commentAnchorsKey, true));
    return onOpen;
  }

  it('tints the commented words and puts a named, pressable marker after them — for viewers too', () => {
    const writerDoc = seeded();
    const writer = open(writerDoc);
    const anchor = anchorLine(writer, 'second line');
    // The viewer opens the state the writer saved.
    const viewerDoc = new Y.Doc();
    Y.applyUpdate(viewerDoc, Y.encodeStateAsUpdate(writerDoc));
    const viewer = open(viewerDoc, false);
    const onOpen = mark(viewer, anchor);
    const tinted = viewer.view.dom.querySelector('.lyrics-comment-anchor');
    expect(tinted?.textContent).toBe('second line');
    const marker = viewer.view.dom.querySelector<HTMLButtonElement>('button.lyrics-comment-marker');
    expect(marker?.getAttribute('aria-label')).toBe('Comment by Sam on “second line”, 1 reply');
    marker?.click();
    expect(onOpen).toHaveBeenCalledWith('T1');
  });

  it('draws nothing for an orphaned anchor', () => {
    const editor = open();
    const anchor = anchorLine(editor, 'second line');
    editor.commands.deleteRange(rangeForScope(editor.state, 'line')!);
    mark(editor, anchor);
    expect(editor.view.dom.querySelector('.lyrics-comment-marker')).toBeNull();
  });
});

describe('commenting on the lyrics (task 092)', () => {
  it('takes the range when the comment begins, and posts it with its quote', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ threadId: 'T9', commentId: 'C9' }), { status: 201 });
        }
        return new Response(JSON.stringify({ threads: [], canComment: true }));
      }),
    );
    const editor = open();
    cursorOn(editor, 'second line');
    render(<LyricComments songId="S-new" editor={editor} active={null} onShow={() => {}} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Comment on this line' }));
    // The cursor moves and the text changes before the comment is sent.
    act(() => {
      cursorOn(editor, 'first line');
      editor.commands.insertContent(' edited meanwhile');
    });
    fireEvent.change(screen.getByLabelText('Comment on “second line”'), {
      target: { value: 'Too wordy' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(posts).toHaveLength(1);
    const posted = posts[0] as { anchor: LyricAnchor & { kind: string }; body: string };
    expect(posted.anchor).toMatchObject({ kind: 'lyric', quote: 'second line', scope: 'line' });
    expect(wordsAt(editor, posted.anchor)).toBe('second line');
  });

  it('offers no way to comment to someone who may only view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ threads: [], canComment: false }))),
    );
    render(<LyricComments songId="S-view" editor={open()} active={null} onShow={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /Comment on/ })).toBeNull();
  });
});
