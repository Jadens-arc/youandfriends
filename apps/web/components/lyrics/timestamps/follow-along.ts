'use client';

import type { Editor } from '@tiptap/core';
import * as React from 'react';

import { getPlayer } from '@/lib/player/store';

import { anchorsOf, currentLineAt, playingLine } from './extension';

/** A person scrolling in the last this-many milliseconds is reading, not following. */
export const SCROLL_YIELD_MS = 4_000;

/**
 * Follow-along: while this song plays, mark the line whose moment has most recently passed, and
 * bring it into view — unless the person has scrolled recently, in which case they are reading
 * something else and the page stays where they put it. Smooth scrolling only without reduced
 * motion.
 */
export function useFollowAlong(
  editor: Editor | null,
  songId: string | null,
  reducedMotion: boolean,
): void {
  React.useEffect(() => {
    if (editor === null || songId === null) return;
    let lastUserScroll = -Infinity;
    const scrolled = () => {
      lastUserScroll = Date.now();
    };
    const keys = (event: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
        scrolled();
      }
    };
    window.addEventListener('wheel', scrolled, { passive: true, capture: true });
    window.addEventListener('touchmove', scrolled, { passive: true, capture: true });
    window.addEventListener('keydown', keys, { capture: true });

    const player = getPlayer();
    const update = () => {
      if (editor.isDestroyed) return;
      const state = player.getState();
      const here = state.track?.songId === songId && state.status !== 'idle';
      const pos = here
        ? currentLineAt(anchorsOf(editor.state.doc), state.positionSeconds * 1000)
        : null;
      if (pos === playingLine(editor.state)) return;
      editor.commands.setPlayingLine(pos);
      if (pos === null || Date.now() - lastUserScroll < SCROLL_YIELD_MS) return;
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement && typeof dom.scrollIntoView === 'function') {
        dom.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    };
    update();
    const unsubscribe = player.subscribe(update);
    return () => {
      unsubscribe();
      window.removeEventListener('wheel', scrolled, { capture: true });
      window.removeEventListener('touchmove', scrolled, { capture: true });
      window.removeEventListener('keydown', keys, { capture: true });
    };
  }, [editor, songId, reducedMotion]);
}
