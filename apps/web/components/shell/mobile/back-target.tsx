'use client';

import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import * as React from 'react';

/**
 * A page's own "back" destination for the mobile header.
 *
 * `MobileHeader` derives its back link from the path — the right answer for `/library/<a>/<b>`,
 * the wrong one for `/songs/<id>`, whose parent is its project, not a `/songs` index that does
 * not exist. A page whose logical parent is not its path prefix declares it with
 * {@link MobileBackTarget}. The declaration is keyed by pathname, so a stale target from the
 * previous page can never apply to the next one while it is still rendering.
 */
export interface BackTarget {
  readonly pathname: string;
  readonly href: Route;
  readonly label: string;
}

let current: BackTarget | null = null;
const listeners = new Set<() => void>();

function publish(next: BackTarget | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The declared target for the current path, or `null` to fall back to the path's parent. */
export function useBackTarget(): BackTarget | null {
  const pathname = usePathname();
  const target = React.useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return target !== null && target.pathname === pathname ? target : null;
}

export function MobileBackTarget({
  href,
  label,
}: {
  readonly href: Route;
  readonly label: string;
}) {
  const pathname = usePathname();
  React.useEffect(() => {
    const target = { pathname, href, label };
    publish(target);
    return () => {
      if (current === target) publish(null);
    };
  }, [pathname, href, label]);
  return null;
}
