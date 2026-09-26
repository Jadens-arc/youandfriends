'use client';

import * as React from 'react';

/**
 * The unread count on the client (task `095`): one poller for the page, however many badges show
 * it. Polling, not push — iteration one's decision — with backoff: every minute while things are
 * fine, doubling up to fifteen minutes while the server is failing, paused while the tab is
 * hidden, and checked at once when it comes back.
 */

const BASE_MS = 60_000;
const MAX_MS = 15 * 60_000;

let unread: number | null = null;
let delay = BASE_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (listeners.size === 0 || (typeof document !== 'undefined' && document.hidden)) return;
  timer = setTimeout(() => void refreshUnread(), delay);
}

/** Ask the server now. Everything showing the count updates. */
export function refreshUnread(): Promise<void> {
  inflight ??= (async () => {
    try {
      const response = await fetch('/api/notifications?unread=1', { cache: 'no-store' });
      const body = response.ok ? ((await response.json()) as { unread?: unknown }) : null;
      if (typeof body?.unread !== 'number') throw new Error('unexpected answer');
      unread = body.unread;
      delay = BASE_MS;
    } catch {
      // Keep the last known count; ask again later, less often.
      delay = Math.min(MAX_MS, delay * 2);
    } finally {
      inflight = null;
      emit();
      schedule();
    }
  })();
  return inflight;
}

/** Set from a fresh list, so the badge agrees with what was just shown. */
export function setUnread(count: number): void {
  unread = count;
  emit();
}

function onVisible() {
  if (!document.hidden) void refreshUnread();
  else schedule();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible);
    void refreshUnread();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}

/** Unread entries, or null before the first answer. */
export function useUnreadCount(): number | null {
  return React.useSyncExternalStore(
    subscribe,
    () => unread,
    () => null,
  );
}

/** For tests: forget everything. */
export function resetUnread(): void {
  unread = null;
  delay = BASE_MS;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  inflight = null;
}

/** For tests: the current backoff. */
export function currentDelay(): number {
  return delay;
}
