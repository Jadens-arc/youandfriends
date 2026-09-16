'use client';

import * as React from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Durations already collapse to zero at the token layer (`styles/tokens.css`), so CSS
 * transitions need no help. This hook exists for the motion we drive from JavaScript — the
 * bottom sheet's settle spring — which CSS cannot reach.
 *
 * `useSyncExternalStore` rather than an effect: the preference is external mutable state, it
 * has to produce a stable server snapshot, and reading it in an effect would render once with
 * the wrong answer first.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
  // Older Safari exposed only `addListener`; treat an absent modern API as "cannot observe"
  // rather than throwing, since the snapshot is still correct at first paint.
  const list = globalThis.matchMedia?.(QUERY);
  if (!list?.addEventListener) return () => {};

  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

/**
 * The server cannot know the preference. Animating is the assumption that matches the token
 * defaults, and the client corrects it on hydration.
 */
function getServerSnapshot(): boolean {
  return false;
}
