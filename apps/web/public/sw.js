/* eslint-disable no-undef */
/**
 * The service worker. Shell only.
 *
 * **What this deliberately does not do is the important part.** It never caches an API
 * response, never caches media, and never caches anything from a request that carried
 * credentials. A service worker is a shared interception point on a device, and a cached
 * authorized response served to the next person to open the app on a shared iPad is a data
 * leak with no authorization story behind it. Offline content is task `203`, where that story
 * gets designed; until then the answer is simply "no" rather than "probably fine"
 * (`docs/THREAT_MODEL.md`, task `100`).
 *
 * So the cache holds what is identical for every visitor signed in or not: the offline page and
 * the icons. Everything else goes to the network.
 */

// Bumping this name is what retires the old cache. It is in one place so a stale asset cannot
// outlive a deploy because two constants disagreed.
const CACHE = 'youandfriends-shell-v1';

/**
 * Precached at install.
 *
 * Only files that are the same bytes for everyone. No route HTML: a page shell would be
 * indistinguishable from a cached authorized page the moment one of them stops being public.
 */
const SHELL = ['/offline', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `addAll` is atomic — one 404 and nothing is cached, which is the honest outcome. A
      // partially populated shell cache is worse than none, because it looks populated.
      .then((cache) => cache.addAll(SHELL))
      // Do not wait for every tab to close. The update prompt in `use-service-worker.ts` is
      // what gives the person the choice; waiting silently for days is what strands them.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Message from the page: the person accepted the update, so stop waiting. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET, only same-origin, and never a credentialed request. Each of these on its own
  // would be enough to keep somebody's music out of the cache; together they are the rule.
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    // Navigations go to the network, and fall back to the offline page rather than to a cached
    // workspace someone else was looking at.
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline').then((r) => r ?? Response.error())),
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // `/api` and `/_next/image` can both carry authorized content. Neither is ever cached here.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/image')) return;
  // Anything but the shell prefixes goes to the network untouched.
  if (!url.pathname.startsWith('/icons/') && !url.pathname.startsWith('/_next/static/')) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // Only a clean, basic response is worth keeping. An opaque or errored one cached is a
          // failure that persists.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
