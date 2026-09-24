import type { Editor } from '@tiptap/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createRelay } from '@/lib/lyrics/__tests__/relay';
import { AUTOSAVE_DEBOUNCE_MS } from '@/lib/lyrics/autosave';
import { SessionFactoryContext, type SessionFactory } from '@/lib/lyrics/collaboration-client';
import { textToLyrics } from '@/lib/lyrics/text-format';
import {
  documentFromYjs,
  LYRICS_FRAGMENT,
  toBase64,
  yjsFromDocument,
  yjsReplace,
} from '@/lib/lyrics/yjs';
import { lyricsToText } from '@/lib/lyrics/text-format';

import { ACCESS_RECHECK_MS, LyricsPanel } from '../lyrics-panel';

const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

const DOCUMENT = textToLyrics('[Chorus]\nStay, stay');
const SEED = yjsFromDocument(DOCUMENT);
const ROOM = 'lyrics:01J00000000000000000000000';

/** GETs answered from `reads` in turn (collaboration on); PUTs recorded and answered `ok`. */
function stubFetch(reads: readonly { canEdit: boolean }[]) {
  let read = 0;
  const puts: { yjsState?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)) as { yjsState?: string });
        return new Response(JSON.stringify({ version: puts.length + 1 }));
      }
      const next = reads[Math.min(read, reads.length - 1)];
      read += 1;
      return new Response(
        JSON.stringify({
          document: DOCUMENT,
          version: 1,
          canEdit: next?.canEdit,
          updatedAt: null,
          yjsState: toBase64(SEED),
          collaboration: { room: ROOM, self: { name: 'Sam', color: 'var(--color-rust-text)' } },
        }),
      );
    }),
  );
  return puts;
}

/** Someone else in the same room, editing through their own document. */
function collaborator(factory: SessionFactory, name: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, SEED);
  const session = factory(ROOM, doc);
  session.awareness.setLocalStateField('user', { name, color: 'var(--color-olive-text)' });
  const firstLine = () => {
    const section = doc.getXmlFragment(LYRICS_FRAGMENT).get(0) as Y.XmlElement;
    return (section.get(0) as Y.XmlElement).get(0) as Y.XmlText;
  };
  return { doc, session, firstLine };
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function surface() {
  const element = screen.getByRole('textbox', { name: 'Lyrics for Headlights' });
  return { element, editor: (element as unknown as { editor: Editor }).editor };
}

describe('LyricsPanel, editing together (task 082)', () => {
  let relay: ReturnType<typeof createRelay>;
  let opened: number;
  let factory: SessionFactory;

  beforeEach(() => {
    vi.useFakeTimers();
    relay = createRelay();
    opened = 0;
    factory = (room, doc) => {
      opened += 1;
      return relay.factory(room, doc);
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mount() {
    render(
      <SessionFactoryContext.Provider value={factory}>
        <LyricsPanel songId="01J00000000000000000000000" songTitle="Headlights" />
      </SessionFactoryContext.Provider>,
    );
    await settle(100);
  }

  it('shows who is here and announces arrivals and departures, not cursor movement', async () => {
    stubFetch([{ canEdit: true }]);
    await mount();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);

    const alex = collaborator(relay.factory, 'Alex');
    await settle();
    expect(screen.getByRole('list', { name: 'Also here' })).toHaveTextContent('Alex');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Alex joined the lyrics.');

    // Cursor movement changes awareness but not who is here: no new announcement.
    act(() => alex.session.awareness.setLocalStateField('cursor', { anchor: 1, head: 1 }));
    expect(live).toHaveTextContent('Alex joined the lyrics.');

    act(() => alex.session.destroy());
    await settle();
    expect(live).toHaveTextContent('Alex left the lyrics.');
  });

  it('shows another person’s words as they type, and leaves saving them to them', async () => {
    const puts = stubFetch([{ canEdit: true }]);
    await mount();
    const alex = collaborator(relay.factory, 'Alex');
    act(() => alex.firstLine().insert(0, 'Alex: '));
    await settle(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(surface().element).toHaveTextContent('Alex: Stay, stay');
    expect(puts).toHaveLength(0);
  });

  it('saves its own edits with the shared state, for the server to merge', async () => {
    const puts = stubFetch([{ canEdit: true }]);
    await mount();
    act(() => {
      surface().editor.chain().focus('end').insertContent(' — Sam').run();
    });
    await settle(AUTOSAVE_DEBOUNCE_MS);
    expect(puts).toHaveLength(1);
    const state = new Y.Doc();
    Y.applyUpdate(
      state,
      Uint8Array.from(atob(puts[0]?.yjsState ?? ''), (c) => c.charCodeAt(0)),
    );
    expect(state.getXmlFragment(LYRICS_FRAGMENT).toString()).toContain('Stay, stay — Sam');
  });

  it('keeps writing and saving when the room is unreachable, and says so', async () => {
    const puts = stubFetch([{ canEdit: true }]);
    await mount();
    const { editor } = surface();
    const doc = (
      editor.extensionManager.extensions.find((e) => e.name === 'collaboration')?.options as {
        document: Y.Doc;
      }
    ).document;
    act(() => relay.disconnect(doc));
    expect(screen.getAllByText(/Working alone/).length).toBeGreaterThan(0);
    act(() => {
      editor.chain().focus('end').insertContent(' offline').run();
    });
    await settle(AUTOSAVE_DEBOUNCE_MS);
    expect(puts).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('stops accepting input and rejoins read-only when access is lowered mid-session', async () => {
    stubFetch([{ canEdit: true }, { canEdit: false }]);
    await mount();
    expect(surface().element).toHaveAttribute('contenteditable', 'true');
    expect(opened).toBe(1);
    await settle(ACCESS_RECHECK_MS);
    expect(surface().element).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Section' })).toBeNull();
    // A new session asks the server for a new token, at the new access.
    expect(opened).toBe(2);
    expect(relay.count()).toBe(1);
  });

  it('carries a restore to everyone in the room', async () => {
    const draft = textToLyrics('[Verse]\nAn older verse, restored');
    const { update } = yjsReplace(SEED, draft);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/restore')) {
          return new Response(
            JSON.stringify({
              version: 3,
              document: draft,
              yjsUpdate: toBase64(update),
              beforeRevisionId: 'B',
            }),
          );
        }
        if (url.endsWith('/revisions')) {
          return new Response(
            JSON.stringify({
              revisions: [
                {
                  id: 'R1',
                  kind: 'checkpoint',
                  name: 'Old verse',
                  createdAt: '2026-09-20T10:00:00Z',
                  author: 'Alex',
                },
              ],
            }),
          );
        }
        if (url.includes('/revisions/')) {
          return new Response(JSON.stringify({ id: 'R1', document: draft }));
        }
        if (init?.method === 'PUT') return new Response(JSON.stringify({ version: 4 }));
        return new Response(
          JSON.stringify({
            document: DOCUMENT,
            version: 1,
            canEdit: true,
            updatedAt: null,
            yjsState: toBase64(SEED),
            collaboration: { room: ROOM, self: { name: 'Sam', color: 'var(--color-rust-text)' } },
          }),
        );
      }),
    );
    await mount();
    const alex = collaborator(relay.factory, 'Alex');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Old verse/ }));
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore this draft' }));
    });
    await settle();
    expect(lyricsToText(documentFromYjs(Y.encodeStateAsUpdate(alex.doc)))).toBe(
      '[Verse]\nAn older verse, restored',
    );
  });
});
