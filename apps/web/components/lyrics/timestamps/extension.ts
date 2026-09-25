import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { currentSection } from '../editor/schema';

import { timestampButton } from './button';
import { playFrom, playheadFor, type LyricsTiming } from './playback';

/**
 * Timestamp anchors (task `083`): a section or a line can point at a moment in the song.
 *
 * A timestamp is an **attribute of the node** — the section or line itself — not a character
 * offset, so typing above it, splitting the text around it, or moving its section carries it
 * along. It belongs to the song, not to a version: versions share lyrics but not always timing,
 * so on another version the same anchor is a best-effort pointer, and the editor says so.
 *
 * Shown as a small monospace button with tabular figures at the start of the line (or beside the
 * section heading); pressing it plays the song from there. While the song plays, the line whose
 * moment has most recently passed is marked as current.
 */

export interface TimestampOptions {
  /** Said when stamping is not possible — no song of this page is loaded. */
  readonly onRefused: (message: string) => void;
}

/**
 * The song these lyrics belong to, set by the editor's host after creation, so a change of song
 * or version does not rebuild the editor. Null until set: nothing can be stamped or played.
 */
export interface TimestampStorage {
  timing: LyricsTiming | null;
  readonly setTiming: (timing: LyricsTiming | null) => void;
  readonly playhead: () => number | null;
  readonly seek: (ms: number) => void;
}

/** The timestamp extension's storage on a live editor. */
export function timestampStorage(editor: Editor): TimestampStorage {
  return (editor.storage as unknown as { lyricsTimestamps: TimestampStorage }).lyricsTimestamps;
}

export const NOT_LOADED_MESSAGE = 'Play this song first — a timestamp is taken from its playhead.';

const followKey = new PluginKey<{ readonly pos: number | null }>('lyricsFollowAlong');
const timestampsKey = new PluginKey('lyricsTimestamps');

/** Where a moment is anchored, in document order. */
export interface Anchor {
  readonly pos: number;
  readonly ms: number;
  readonly kind: 'section' | 'line';
}

/** Every anchor. A section's timestamp stands for its first line. */
export function anchorsOf(doc: PMNode): Anchor[] {
  const anchors: Anchor[] = [];
  doc.forEach((section, sectionOffset) => {
    const sectionMs = section.attrs.timestampMs as number | null;
    if (typeof sectionMs === 'number') {
      anchors.push({ pos: sectionOffset + 1, ms: sectionMs, kind: 'section' });
    }
    section.forEach((line, lineOffset) => {
      const ms = line.attrs.timestampMs as number | null;
      if (typeof ms === 'number') {
        anchors.push({ pos: sectionOffset + 1 + lineOffset, ms, kind: 'line' });
      }
    });
  });
  return anchors;
}

/**
 * The line playing at `ms`: of the anchors whose moment has passed, the latest moment — not the
 * last in the document, since a repeated chorus can be stamped out of order. Ties go to the later
 * line. Returns a line position (a section anchor resolves to its first line).
 */
export function currentLineAt(anchors: readonly Anchor[], ms: number): number | null {
  let best: Anchor | null = null;
  for (const anchor of anchors) {
    if (anchor.ms > ms) continue;
    if (best === null || anchor.ms > best.ms || (anchor.ms === best.ms && anchor.pos >= best.pos)) {
      best = anchor;
    }
  }
  return best === null ? null : best.pos;
}

/** The position of the line holding the cursor. */
function currentLine(state: EditorState): number | null {
  const { $from } = state.selection;
  if ($from.depth < 2) return null;
  return $from.before(2);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lyricsTimestamps: {
      /** Set (or with `null`, clear) the timestamp of the line holding the cursor. */
      setLineTimestamp: (ms: number | null) => ReturnType;
      setSectionTimestamp: (ms: number | null) => ReturnType;
      /** Stamp the current line from the loaded song's playhead — the one-keystroke path. */
      stampLine: () => ReturnType;
      stampSection: () => ReturnType;
      /** Mark the line playing now (follow-along); `null` clears the mark. */
      setPlayingLine: (pos: number | null) => ReturnType;
    };
  }
}

/** Bound the value the contract accepts: whole milliseconds, zero to six hours. */
const clampMs = (ms: number) => Math.min(6 * 60 * 60 * 1000, Math.max(0, Math.round(ms)));

export const LyricsTimestamps = Extension.create<TimestampOptions>({
  name: 'lyricsTimestamps',

  addOptions() {
    return { onRefused: () => {} };
  },

  addStorage(): TimestampStorage {
    const storage: TimestampStorage = {
      timing: null,
      setTiming: (timing) => {
        storage.timing = timing;
      },
      playhead: () => (storage.timing === null ? null : playheadFor(storage.timing.songId)),
      seek: (ms) => {
        if (storage.timing !== null) playFrom(storage.timing, ms);
      },
    };
    return storage;
  },

  addCommands() {
    return {
      setLineTimestamp:
        (ms) =>
        ({ state, tr, dispatch }) => {
          const pos = currentLine(state);
          if (pos === null) return false;
          if (dispatch) tr.setNodeAttribute(pos, 'timestampMs', ms === null ? null : clampMs(ms));
          return true;
        },
      setSectionTimestamp:
        (ms) =>
        ({ state, tr, dispatch }) => {
          const here = currentSection(state);
          if (here === null) return false;
          if (dispatch) {
            tr.setNodeAttribute(here.pos, 'timestampMs', ms === null ? null : clampMs(ms));
          }
          return true;
        },
      stampLine:
        () =>
        ({ commands }) => {
          const ms = (this.storage as TimestampStorage).playhead();
          if (ms === null) {
            this.options.onRefused(NOT_LOADED_MESSAGE);
            return false;
          }
          return commands.setLineTimestamp(ms);
        },
      stampSection:
        () =>
        ({ commands }) => {
          const ms = (this.storage as TimestampStorage).playhead();
          if (ms === null) {
            this.options.onRefused(NOT_LOADED_MESSAGE);
            return false;
          }
          return commands.setSectionTimestamp(ms);
        },
      setPlayingLine:
        (pos) =>
        ({ tr, dispatch }) => {
          // Presentation only: not an edit, not undoable, not saved.
          if (dispatch) tr.setMeta(followKey, { pos }).setMeta('addToHistory', false);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-t': ({ editor }) => (editor as Editor).commands.stampLine(),
      'Mod-Alt-Shift-t': ({ editor }) => (editor as Editor).commands.stampSection(),
    };
  },

  addProseMirrorPlugins() {
    const seek = (ms: number) => (this.storage as TimestampStorage).seek(ms);
    return [
      new Plugin({
        key: timestampsKey,
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.forEach((section, sectionOffset) => {
              section.forEach((line, lineOffset) => {
                const ms = line.attrs.timestampMs as number | null;
                if (typeof ms !== 'number') return;
                decorations.push(
                  Decoration.widget(
                    sectionOffset + 1 + lineOffset + 1,
                    () => timestampButton(ms, 'this line', seek),
                    {
                      side: -1,
                      ignoreSelection: true,
                      stopEvent: () => true,
                      key: `line-${ms}`,
                    },
                  ),
                );
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
      new Plugin({
        key: followKey,
        state: {
          init: () => ({ pos: null as number | null }),
          apply: (tr, previous) => {
            const meta = tr.getMeta(followKey) as { pos: number | null } | undefined;
            if (meta !== undefined) return { pos: meta.pos };
            if (previous.pos === null || !tr.docChanged) return previous;
            const mapped = tr.mapping.mapResult(previous.pos);
            return { pos: mapped.deleted ? null : mapped.pos };
          },
        },
        props: {
          decorations: (state) => {
            const pos = followKey.getState(state)?.pos ?? null;
            const node = pos === null ? null : state.doc.nodeAt(pos);
            if (pos === null || node?.type.name !== 'lyricsLine') return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, {
                class: 'lyrics-line--current',
                'aria-current': 'true',
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/** The follow-along mark's current position, for tests and scrolling. */
export function playingLine(state: EditorState): number | null {
  return followKey.getState(state)?.pos ?? null;
}
