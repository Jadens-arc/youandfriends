import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, isPublicRoute, showcaseGuard } from './proxy';

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
    for (const path of ['/sign-in', '/sign-in/factor-one', '/sign-up', '/api/webhooks/clerk']) {
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
    for (const path of ['/sign-in-not-really', '/api/webhooksss', '/x/sign-in']) {
      expect(isPublicRoute(request(path)), path).toBe(false);
    }
  });
});
