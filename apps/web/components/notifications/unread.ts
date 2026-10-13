'use client';

import * as React from 'react';

/**
 * The unread count for the shell (task `095`), polled — realtime delivery is out of scope for
 * iteration one. Every minute while the page is visible; after a failure the wait doubles, up to
 * ten minutes, so an outage is not met with a stampede. A change made here (marking read) asks
 * for a fresh count at once through {@link announceNotificationsChanged}.
 */

const BASE_MS = 60_000;
const MAX_MS = 10 * 60_000;
const CHANGED = 'youandfriends:notifications-changed';

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

export function useUnreadCount(): number | null {
  const [count, setCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    let wait = BASE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const poll = async () => {
      if (timer !== undefined) clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { unread?: unknown };
          if (live && typeof body.unread === 'number') setCount(body.unread);
          wait = BASE_MS;
        } catch {
          wait = Math.min(wait * 2, MAX_MS);
        }
      }
      if (live) timer = setTimeout(() => void poll(), wait);
    };
    const now = () => void poll();
    void poll();
    window.addEventListener(CHANGED, now);
    document.addEventListener('visibilitychange', now);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener(CHANGED, now);
      document.removeEventListener('visibilitychange', now);
    };
  }, []);
  return count;
}
