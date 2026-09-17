import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CACHEABLE_PREFIXES, mayCache, NEVER_CACHED_PREFIXES } from '../cache-policy';

const get = (pathname: string, sameOrigin = true) => ({ method: 'GET', sameOrigin, pathname });

describe('what the service worker may keep', () => {
  it('keeps the shell assets that are the same bytes for everyone', () => {
    expect(mayCache(get('/icons/icon-192.png'))).toBe(true);
    expect(mayCache(get('/_next/static/chunks/main.js'))).toBe(true);
  });

  it('never keeps an API response', () => {
    // The leak this task exists to avoid: a cached authorized response served to whoever opens
    // the app next on a shared device.
    expect(mayCache(get('/api/songs'))).toBe(false);
    expect(mayCache(get('/api/workspaces/1/members'))).toBe(false);
  });

  it('never keeps optimized images, which can be authorized media', () => {
    expect(mayCache(get('/_next/image?url=%2Fcover.png'))).toBe(false);
  });

  it('never keeps anything from another origin', () => {
    // An opaque cross-origin response cached is a failure that persists.
    expect(mayCache(get('/icons/icon-192.png', false))).toBe(false);
  });

  it('never keeps a non-GET', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(mayCache({ method, sameOrigin: true, pathname: '/icons/icon-192.png' })).toBe(false);
    }
  });

  it('keeps nothing it was not told to keep', () => {
    // A deny-by-default list, so a route added later is uncached by being new — the same
    // direction the proxy's public-route list falls in.
    for (const path of ['/library', '/', '/trash', '/settings', '/whatever-lands-next']) {
      expect(mayCache(get(path)), path).toBe(false);
    }
  });

  it('the worker itself carries the same guards', () => {
    // `public/sw.js` is served as a static file and cannot import this module, so the rule is
    // written twice. This is what stops the two drifting: the guards have to be present in the
    // worker's source, by the same strings this module exports.
    const worker = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

    for (const prefix of NEVER_CACHED_PREFIXES) {
      expect(worker, `sw.js must refuse ${prefix}`).toContain(prefix);
    }
    for (const prefix of CACHEABLE_PREFIXES) {
      expect(worker, `sw.js must allow ${prefix}`).toContain(prefix);
    }
    expect(worker).toContain("request.method !== 'GET'");
    expect(worker).toContain('self.location.origin');
  });

  it('the worker precaches nothing that could carry user data', () => {
    const worker = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    const shell = /const SHELL = \[([^\]]*)\]/.exec(worker)?.[1] ?? '';

    expect(shell).not.toBe('');
    // Every precached entry must be the offline page or an icon. A route shell here would be
    // indistinguishable from a cached authorized page the moment it stopped being public.
    for (const entry of shell.split(',').map((s) => s.trim().replace(/['"]/g, ''))) {
      if (entry === '') continue;
      expect(entry === '/offline' || entry.startsWith('/icons/'), entry).toBe(true);
    }
  });
});
