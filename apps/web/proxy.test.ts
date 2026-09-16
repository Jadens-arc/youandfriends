import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy, config } from './proxy';

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, 'https://youandfriends.org'));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('refuses the showcase in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');

    // 404, never 403: a forbidden response confirms the path exists (THREAT_MODEL T1).
    expect(proxy(request('/_showcase')).status).toBe(404);
    expect(proxy(request('/_showcase/anything')).status).toBe(404);
  });

  it('allows the showcase where it is meant to exist', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');

    expect(proxy(request('/_showcase')).status).toBe(200);
  });

  it('matches the bare segment as well as everything under it', () => {
    // `/_showcase/:path*` alone does not cover `/_showcase`, which would leave the page
    // itself unguarded.
    expect(config.matcher).toContain('/_showcase');
    expect(config.matcher).toContain('/_showcase/:path*');
  });
});
