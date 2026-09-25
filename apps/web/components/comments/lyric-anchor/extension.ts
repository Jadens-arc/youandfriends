import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { resolveAnchor, type LyricAnchor } from '@/lib/lyrics/anchors';

/**
 * Lyric comments in the editor (task `092`): each commented range gets a subtle underline tint,
 * and a small button where it ends — "Comment by Sam on ‘Headlights on…’" — that opens the
 * thread. The button is how a screen reader finds that a line has comments; the tint alone would
 * be invisible to it. Orphaned anchors (their words deleted) draw nothing here; the thread list
 * shows them with their quote.
 */

export interface AnchorThread {
  readonly id: string;
  readonly anchor: Pick<LyricAnchor, 'start' | 'end' | 'quote'>;
  /** The button's accessible name. */
  readonly label: string;
}

export interface AnchorStorage {
  threads: readonly AnchorThread[];
  active: string | null;
  onOpen: (threadId: string) => void;
  readonly set: (
    threads: readonly AnchorThread[],
    active: string | null,
    onOpen: (threadId: string) => void,
  ) => void;
  /** The current values, read through the closure — whichever copy of the storage is at hand. */
  readonly read: () => {
    readonly threads: readonly AnchorThread[];
    readonly active: string | null;
    readonly onOpen: (threadId: string) => void;
  };
}

export const commentAnchorsKey = new PluginKey('lyricCommentAnchors');

export function anchorStorage(editor: Editor): AnchorStorage {
  return (editor.storage as unknown as { lyricCommentAnchors: AnchorStorage }).lyricCommentAnchors;
}

/** A small speech bubble, built as SVG elements rather than parsed markup. */
function bubble(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'lyrics-comment-marker-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
  svg.append(path);
  return svg;
}

function marker(thread: AnchorThread, open: (id: string) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.className = 'lyrics-comment-marker';
  button.dataset.thread = thread.id;
  button.setAttribute('aria-label', thread.label);
  button.title = thread.label;
  button.append(bubble());
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    open(thread.id);
  });
  return button;
}

export const LyricCommentAnchors = Extension.create({
  name: 'lyricCommentAnchors',

  addStorage(): AnchorStorage {
    const storage: AnchorStorage = {
      threads: [],
      active: null,
      onOpen: () => {},
      set: (threads, active, onOpen) => {
        storage.threads = threads;
        storage.active = active;
        storage.onOpen = onOpen;
      },
      read: () => ({ threads: storage.threads, active: storage.active, onOpen: storage.onOpen }),
    };
    return storage;
  },

  addProseMirrorPlugins() {
    const storage = this.storage as AnchorStorage;
    return [
      new Plugin({
        key: commentAnchorsKey,
        props: {
          decorations: (state) => {
            const { threads, active: activeId, onOpen } = storage.read();
            if (threads.length === 0) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            for (const thread of threads) {
              const range = resolveAnchor(state, thread.anchor);
              if (range === null) continue;
              const active = activeId === thread.id;
              decorations.push(
                Decoration.inline(range.from, range.to, {
                  class: active
                    ? 'lyrics-comment-anchor lyrics-comment-anchor--active'
                    : 'lyrics-comment-anchor',
                  'data-thread': thread.id,
                }),
                Decoration.widget(range.to, () => marker(thread, (id) => onOpen(id)), {
                  side: 1,
                  ignoreSelection: true,
                  stopEvent: () => true,
                  key: `comment-${thread.id}`,
                }),
              );
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
