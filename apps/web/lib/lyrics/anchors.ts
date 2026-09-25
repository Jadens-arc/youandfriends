import type { EditorState } from '@tiptap/pm/state';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';

/**
 * Where a lyric comment points (task `092`): a range of the lyrics as **Yjs relative positions**,
 * which name the characters themselves rather than their offsets — typing above, rewording
 * around, or another person's concurrent edits leave the range on the same words. The words
 * quoted at the time are kept alongside, so a comment whose words are later deleted still says
 * what it was about.
 */

export const LYRIC_ANCHOR_SCOPES = ['selection', 'line', 'section'] as const;
export type LyricAnchorScope = (typeof LYRIC_ANCHOR_SCOPES)[number];

export interface LyricAnchor {
  readonly start: Record<string, unknown>;
  readonly end: Record<string, unknown>;
  /** The words as they were when the comment was made. */
  readonly quote: string;
  readonly scope: LyricAnchorScope;
}

/** The longest quote kept with a comment. */
export const QUOTE_MAX = 500;

/** The binding's map between ProseMirror nodes and Yjs types, as the position helpers take it. */
type ProsemirrorMapping = Parameters<typeof absolutePositionToRelativePosition>[2];

interface SyncState {
  readonly doc: Y.Doc;
  readonly type: Y.XmlFragment;
  readonly binding: { readonly mapping: ProsemirrorMapping };
}

function syncState(state: EditorState): SyncState | null {
  const sync = ySyncPluginKey.getState(state) as SyncState | undefined;
  return sync?.binding === undefined ? null : sync;
}

/** The range a scope covers at the cursor: the selection, its line, or its section. */
export function rangeForScope(
  state: EditorState,
  scope: LyricAnchorScope,
): { from: number; to: number } | null {
  const { from, to, $from } = state.selection;
  if (scope === 'selection') return from === to ? null : { from, to };
  const depth = scope === 'line' ? 2 : 1;
  if ($from.depth < depth) return null;
  const start = $from.start(depth);
  const end = $from.end(depth);
  return end > start ? { from: start, to: end } : null;
}

/** Anchor the range `from`–`to` of the editor's document, or null outside a Yjs-bound editor. */
export function anchorFromRange(
  state: EditorState,
  range: { from: number; to: number },
  scope: LyricAnchorScope,
): LyricAnchor | null {
  const sync = syncState(state);
  if (sync === null || range.to <= range.from) return null;
  const start = absolutePositionToRelativePosition(range.from, sync.type, sync.binding.mapping);
  const end = absolutePositionToRelativePosition(range.to, sync.type, sync.binding.mapping);
  const quote = state.doc.textBetween(range.from, range.to, '\n').slice(0, QUOTE_MAX);
  return {
    start: Y.relativePositionToJSON(start) as Record<string, unknown>,
    end: Y.relativePositionToJSON(end) as Record<string, unknown>,
    quote,
    scope,
  };
}

/**
 * Where an anchor is now — or null when its words are gone (an **orphaned** anchor): the range
 * has collapsed to nothing, or its positions no longer resolve in this document.
 */
export function resolveAnchor(
  state: EditorState,
  anchor: Pick<LyricAnchor, 'start' | 'end'>,
): { from: number; to: number } | null {
  const sync = syncState(state);
  if (sync === null) return null;
  try {
    const from = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.createRelativePositionFromJSON(anchor.start),
      sync.binding.mapping,
    );
    const to = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.createRelativePositionFromJSON(anchor.end),
      sync.binding.mapping,
    );
    if (from === null || to === null || to <= from) return null;
    // Nothing but structure between them: the words themselves were deleted.
    if (state.doc.textBetween(from, to, '').trim() === '') return null;
    return { from, to };
  } catch {
    return null;
  }
}
