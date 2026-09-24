'use client';

import type { Editor } from '@tiptap/core';
import * as React from 'react';

/**
 * The on-screen keyboard, for writing lyrics on a phone (task `085`).
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens — it overlays it — so
 * `vh`, `dvh`, and a plain `scrollIntoView` all leave the caret behind the keyboard. The Visual
 * Viewport API is the one reliable measure of what is actually visible: the keyboard is whatever
 * of the window it no longer covers.
 */

export interface ViewportLike {
  readonly height: number;
  readonly offsetTop: number;
}

/** Pixels of the window's bottom covered by the keyboard (or any other overlay), never negative. */
export function keyboardInset(viewport: ViewportLike, innerHeight: number): number {
  return Math.max(0, Math.round(innerHeight - viewport.height - viewport.offsetTop));
}

/**
 * How far to scroll so the caret sits inside the visible band, with `margin` to spare: positive
 * scrolls down, negative up, zero when it is already comfortably visible.
 */
export function caretScrollDelta(
  caret: { readonly top: number; readonly bottom: number },
  visible: { readonly top: number; readonly bottom: number },
  margin = 24,
): number {
  if (caret.bottom > visible.bottom - margin) return caret.bottom - (visible.bottom - margin);
  if (caret.top < visible.top + margin) return caret.top - (visible.top + margin);
  return 0;
}

/** The keyboard inset now, following the visual viewport as the keyboard opens and closes. */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || viewport === undefined || viewport === null) return;
    const update = () => setInset(keyboardInset(viewport, window.innerHeight));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [enabled]);
  return inset;
}

/**
 * Keep the caret in the part of `scroller` the person can see — above the keyboard and the docked
 * controls (`reserved` pixels) — whenever the selection moves or the keyboard changes size.
 */
export function useKeepCaretVisible(
  editor: Editor | null,
  scroller: React.RefObject<HTMLElement | null>,
  options: { readonly enabled: boolean; readonly inset: number; readonly reserved: number },
): void {
  const { enabled, inset, reserved } = options;
  React.useEffect(() => {
    if (!enabled || editor === null) return;
    const reveal = () => {
      const container = scroller.current;
      if (container === null || editor.isDestroyed || !editor.isFocused) return;
      const viewport = window.visualViewport;
      const bottom =
        (viewport ? viewport.offsetTop + viewport.height : window.innerHeight) - reserved;
      const top = Math.max(container.getBoundingClientRect().top, viewport?.offsetTop ?? 0);
      let caret: { top: number; bottom: number };
      try {
        caret = editor.view.coordsAtPos(editor.state.selection.head);
      } catch {
        return;
      }
      const delta = caretScrollDelta(caret, { top, bottom });
      if (delta === 0) return;
      // `scrollBy` with options is missing from older Safari; `scrollTop` works everywhere.
      if (typeof container.scrollBy === 'function') container.scrollBy({ top: delta });
      else container.scrollTop += delta;
    };
    reveal();
    editor.on('selectionUpdate', reveal);
    editor.on('focus', reveal);
    return () => {
      editor.off('selectionUpdate', reveal);
      editor.off('focus', reveal);
    };
  }, [editor, scroller, enabled, inset, reserved]);
}
