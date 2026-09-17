/**
 * What the service worker is allowed to keep.
 *
 * The rule lives here, tested, because it is a security boundary rather than a performance
 * tweak. A service worker is a shared interception point on a device: a cached authorized
 * response served to the next person to open the app on a shared iPad is a data leak, and it
 * would look exactly like the app working. Offline content is task `203`, where that gets an
 * authorization story; until then the answer is no.
 *
 * `public/sw.js` implements this same rule — it is served as a static file and cannot import,
 * so `__tests__/cache-policy.test.ts` also reads its source and asserts the guards are present.
 * Duplication that a test watches is better than a worker that cannot be tested at all.
 */

/** Prefixes whose bytes are identical for every visitor, signed in or not. */
export const CACHEABLE_PREFIXES = ['/icons/', '/_next/static/'] as const;

/** Prefixes that can carry authorized content and are never cached in this task. */
export const NEVER_CACHED_PREFIXES = ['/api/', '/_next/image'] as const;

export interface CacheDecisionInput {
  readonly method: string;
  readonly sameOrigin: boolean;
  readonly pathname: string;
}

/** True only for a request whose response is safe to keep for anyone. */
export function mayCache({ method, sameOrigin, pathname }: CacheDecisionInput): boolean {
  if (method !== 'GET') return false;
  if (!sameOrigin) return false;
  if (NEVER_CACHED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
