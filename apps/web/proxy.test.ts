import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, isPublicRoute, showcaseGuard } from './proxy';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, 'https://youandfriends.org'));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the showcase lock', () => {
  it('refuses the showcase in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');

    // 404, never 403: a forbidden response confirms the path exists (THREAT_MODEL T1).
    expect(showcaseGuard(request('/_showcase'))?.status).toBe(404);
    expect(showcaseGuard(request('/_showcase/anything'))?.status).toBe(404);
  });

  it('allows the showcase where it is meant to exist', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');

    // `null` means the guard declined to refuse, and the request carries on.
    expect(showcaseGuard(request('/_showcase'))).toBeNull();
  });

  it('is reached by the matcher', () => {
    // The matcher is now the authentication catch-all rather than two showcase paths. The
    // property that matters is unchanged and is what gets asserted: the showcase is matched,
    // bare segment included. A matcher that stopped covering it would leave the page
    // unguarded, and the old literal assertions would not have noticed the pattern changing
    // underneath them.
    const matches = (path: string) =>
      config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

    expect(matches('/_showcase')).toBe(true);
    expect(matches('/_showcase/anything')).toBe(true);
  });
});

describe('route protection', () => {
  it('leaves only the sign-in surfaces and signed webhooks public', () => {
    for (const path of [
      '/sign-in',
      '/sign-in/factor-one',
      '/sign-up',
      '/api/webhooks/clerk',
      '/offline',
    ]) {
      expect(isPublicRoute(request(path)), path).toBe(true);
    }
  });

  it('protects everything else, including routes nobody has written yet', () => {
    // A deny-list of what is public, not an allow-list of what is protected: a new route is
    // protected by being new, which is the direction a mistake should fall.
    for (const path of ['/', '/library', '/trash', '/api/songs', '/whatever-lands-next']) {
      expect(isPublicRoute(request(path)), path).toBe(false);
    }
  });

  it('does not let a lookalike path slip through as public', () => {
    for (const path of [
      '/sign-in-not-really',
      '/api/webhooksss',
      '/x/sign-in',
      '/offline-workspace',
    ]) {
      expect(isPublicRoute(request(path)), path).toBe(false);
    }
  });
});

describe('when authentication is not configured', () => {
  /**
   * The state a fresh deployment is in before its keys are set, and the one this build was
   * actually in on Vercel: the build succeeded and every request returned a bare
   * `Internal Server Error`, because Clerk throws on a missing publishable key.
   *
   * Asserted from source rather than by rendering the proxy: `clerkMiddleware` needs a Clerk
   * runtime to invoke at all, so a test that could call it would need the very thing whose
   * absence is under test.
   */
  const source = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8');

  it('refuses everything rather than serving the workspace unauthenticated', () => {
    // The tempting fix is to serve the app with no authentication when the key is missing.
    // This asserts the opposite shape: one refusal for every route, public ones included,
    // because without Clerk there is no sign-in to send anyone to.
    expect(source).toContain('if (!clerkConfigured) return unconfigured()');
    expect(source).toContain('status: 503');
  });

  it('guards outside clerkMiddleware, not inside its callback', () => {
    // The first attempt put this check in the callback, where it is unreachable:
    // `clerkMiddleware` resolves the publishable key inside its own handler, before the
    // callback is entered, so the throw got there first and production served a bare 500
    // anyway. Deploying it is what found that.
    //
    // So the property is structural: the guard must sit in the exported `proxy`, above the
    // delegation, and never inside `authenticatedProxy`.
    const exportAt = source.indexOf('export default function proxy(');
    const guardAt = source.indexOf('if (!clerkConfigured) return unconfigured()');
    const delegateAt = source.indexOf('return authenticatedProxy(request, event)');
    const callbackAt = source.indexOf('const authenticatedProxy = clerkMiddleware(');

    expect(exportAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(exportAt);
    expect(guardAt).toBeLessThan(delegateAt);
    // And it is after the middleware is constructed, which means it is not inside it.
    expect(guardAt).toBeGreaterThan(callbackAt);
  });

  it('names the variables an operator has to set', () => {
    // A 503 saying "not configured" is barely better than a 500. The point is the next action.
    expect(source).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    expect(source).toContain('CLERK_SECRET_KEY');
  });
});
