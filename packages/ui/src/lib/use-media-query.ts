'use client';

import * as React from 'react';

/**
 * Whether a media query matches, as external state (`useSyncExternalStore`), so it has a stable
 * server answer and updates on rotation or resize without an effect rendering the wrong thing
 * first. The server — and jsdom, which has no `matchMedia` — answers `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = globalThis.matchMedia?.(query);
      if (!list?.addEventListener) return () => {};
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Below the `md` breakpoint: where secondary surfaces become bottom sheets (task `103`). */
export const PHONE_QUERY = '(max-width: 767px)';

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
