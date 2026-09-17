'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker, and offers the update rather than forcing or hiding it.
 *
 * A worker that calls `skipWaiting` on its own swaps the assets under a page that is already
 * open — mid-edit, mid-playback. One that never skips leaves people on stale assets until every
 * tab closes, which on a phone can be weeks. So the worker waits, and this asks.
 */
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          if (next === null) return;
          next.addEventListener('statechange', () => {
            // `installed` with a controller already present means an update is ready, as
            // opposed to the very first install where there is nothing to replace.
            if (next.state === 'installed' && navigator.serviceWorker.controller !== null) {
              setWaiting(next);
            }
          });
        });
      } catch {
        // A failed registration is not a failed app. The product works without it; it just is
        // not installable, and breaking the page over that would be the wrong trade.
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  if (waiting === null) return null;

  return (
    <div
      role="status"
      className="border-border bg-card text-card-foreground fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-4 rounded-md border p-3 shadow-md md:left-auto md:w-80"
    >
      <p className="text-sm">A new version is ready.</p>
      <button
        type="button"
        className="focus-visible:ring-ring rounded-sm px-2 py-1 text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => {
          waiting.postMessage('skip-waiting');
          // The new worker takes over on activation; reloading is what puts the page on it.
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
        }}
      >
        Reload
      </button>
    </div>
  );
}
