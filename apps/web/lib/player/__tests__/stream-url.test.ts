import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchStreamUrl } from '../stream-url';

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('asking for a stream URL', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the URL and its expiry, uncached', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respond(200, { url: 'https://r2.example/x', expiresAt: '2026-09-24T12:15:00.000Z' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchStreamUrl('V1')).toEqual({
      ok: true,
      grant: { url: 'https://r2.example/x', expiresAt: new Date('2026-09-24T12:15:00.000Z') },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stream/V1',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('sorts each refusal into the recovery path it needs', async () => {
    for (const [status, kind] of [
      [404, 'unauthorized'],
      [409, 'not_ready'],
      [503, 'unavailable'],
      [500, 'network'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(status)));
      expect(await fetchStreamUrl('V1')).toEqual({ ok: false, kind });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchStreamUrl('V1')).toEqual({ ok: false, kind: 'network' });
  });

  it('refuses a malformed answer rather than handing the element nonsense', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, { url: 42 })));
    expect(await fetchStreamUrl('V1')).toEqual({ ok: false, kind: 'network' });
  });
});
