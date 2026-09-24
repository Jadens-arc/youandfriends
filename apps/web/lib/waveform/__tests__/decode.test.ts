import { encodeWaveform, type WaveformPeaks } from '@youandfriends/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearWaveformCache, loadWaveform } from '../decode';
import { tierForWidth } from '../tier';

/** Thirty seconds at 44.1 kHz: an overview, a medium and a fine tier, as the generator writes. */
const PEAKS: WaveformPeaks = {
  channels: 2,
  sampleRateHz: 44_100,
  frameCount: 44_100 * 30,
  tiers: [
    { framesPerBucket: 1323, peaks: new Int8Array(2 * 1000).fill(10) },
    { framesPerBucket: 884, peaks: new Int8Array(2 * 1497).fill(20) },
    { framesPerBucket: 221, peaks: new Int8Array(2 * 5987).fill(30) },
  ],
};
const BYTES = encodeWaveform(PEAKS);

describe('choosing a tier by rendered width (task 072)', () => {
  it('gives a narrow compact view the coarse tier, and a wide one finer detail', () => {
    expect(tierForWidth(BYTES, 300).framesPerBucket).toBe(1323);
    expect(tierForWidth(BYTES, 1400).framesPerBucket).toBe(884);
    expect(tierForWidth(BYTES, 6000).framesPerBucket).toBe(221);
    expect(tierForWidth(BYTES, 300)).toMatchObject({ sampleRateHz: 44_100, frameCount: 1_323_000 });
  });
});

describe('loading a version’s waveform', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearWaveformCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches once per version and decodes at each width asked for', async () => {
    fetchMock.mockResolvedValue(new Response(BYTES.slice(), { status: 200 }));
    const wide = await loadWaveform('V1', 6000);
    const narrow = await loadWaveform('V1', 300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/versions/V1/waveform');
    expect(wide.ok && wide.tier.framesPerBucket).toBe(221);
    expect(narrow.ok && narrow.tier.framesPerBucket).toBe(1323);
  });

  it('says why there is no waveform, and asks again next time for one still processing', async () => {
    for (const [status, reason] of [
      [409, 'not_ready'],
      [404, 'unauthorized'],
      [503, 'unavailable'],
      [500, 'error'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
      expect(await loadWaveform(`V-${status}`, 500)).toEqual({ ok: false, reason });
    }
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await loadWaveform('V-later', 500);
    fetchMock.mockResolvedValueOnce(new Response(BYTES.slice(), { status: 200 }));
    expect((await loadWaveform('V-later', 500)).ok).toBe(true);
  });

  it('reports a malformed file as an error rather than drawing it', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    expect(await loadWaveform('V-bad', 500)).toEqual({ ok: false, reason: 'error' });
  });
});
