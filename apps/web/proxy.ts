import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

import { isShowcaseEnabled, SHOWCASE_PATH } from '@/lib/showcase';

/**
 * Proxy (`middleware` before Next 16 renamed it).
 *
 * Two jobs, in this order:
 *
 *  1. **The showcase lock.** Second of two: the showcase's page file is not built at all in
 *     production, and this catches the case where someone renames it back to `page.tsx` and
 *     quietly restores the route. It runs before authentication because it is a 404 about a
 *     route that should not exist, not a decision about who is asking.
 *  2. **Route protection.** Everything except the sign-in surfaces and a handful of public
 *     files requires a session. This is the front door (`docs/DESIGN.md` §1: private by
 *     default), and it is deliberately a deny-list of what is public rather than an allow-list
 *     of what is protected — a new route is protected by being new, which is the direction a
 *     mistake should fall.
 *
 * **Fails closed.** If Clerk cannot resolve a session — unreachable, clock skew, a malformed
 * token — `auth.protect()` throws, and a throw here is a denied request. Nothing in this file
 * catches an error and continues: `NextResponse.next()` on an unresolved session is precisely
 * the bug that makes an authentication boundary decorative.
 */

/**
 * What an unauthenticated request may reach.
 *
 * `/api/webhooks` is public because Clerk signs its webhooks and the handler verifies that
 * signature — a session is the wrong check for a request that has no user behind it.
 */
export const isPublicRoute = createRouteMatcher([
  // The path and its children, never its prefix. `'/sign-in(.*)'` also matches
  // `/sign-in-anything`, so a route added later with that prefix would be public by accident —
  // which is the opposite of "a new route is protected by being new". Caught by its own test.
  '/sign-in',
  '/sign-in/(.*)',
  '/sign-up',
  '/sign-up/(.*)',
  '/api/webhooks',
  '/api/webhooks/(.*)',
  // The service worker's offline fallback. It must be reachable with no session, because it is
  // what a navigation lands on when there is no network — and redirecting to sign-in needs the
  // network. It carries nothing about any workspace, deliberately (task `100`).
  '/offline',
]);

/**
 * The showcase lock, as a plain function.
 *
 * Separate from the Clerk wrapper so it can be exercised directly: a test for "is this route
 * absent in production" should not need a session, a Clerk key, or a network. Returns the
 * refusal, or `null` to mean "not my business".
 */
export function showcaseGuard(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname.startsWith(SHOWCASE_PATH) && !isShowcaseEnabled()) {
    // 404, not 403: a forbidden response confirms the path exists (`docs/THREAT_MODEL.md`
    // T1). Here it also happens to be true — in production the route really is absent.
    return new NextResponse(null, { status: 404 });
  }
  return null;
}

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const refused = showcaseGuard(request);
  if (refused !== null) return refused;

  if (!isPublicRoute(request)) {
    // Throws on failure, and the throw is the point. Redirecting to sign-in is Clerk's
    // behaviour for a browser request; an API route gets a 404-shaped refusal from the
    // handlers themselves.
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except Next's own internals and static files, so a new route is covered by
    // existing. `_next` and anything with a file extension are skipped.
    '/((?!_next|.*\\..*).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};
