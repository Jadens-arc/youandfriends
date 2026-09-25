import { describe, expect, it } from 'vitest';

import {
  decodeWaveform,
  decodeWaveformTierFor,
  encodeWaveform,
  WaveformFormatError,
  type WaveformPeaks,
} from './waveform';

const PEAKS: WaveformPeaks = {
  channels: 2,
  sampleRateHz: 44_100,
  frameCount: 44_100 * 30,
  tiers: [
    { framesPerBucket: 1323, peaks: Int8Array.from([-1, 1, -2, 2]) },
    { framesPerBucket: 884, peaks: Int8Array.from([-3, 3, -4, 4, -5, 5]) },
    { framesPerBucket: 221, peaks: Int8Array.from([-6, 6, -7, 7, -8, 8, -9, 9]) },
  ],
};

describe('decoding one tier for a view (task `072`)', () => {
  const bytes = encodeWaveform(PEAKS);

  it('picks the coarsest tier no wider than a pixel, matching tierFor', () => {
    expect(decodeWaveformTierFor(bytes, 1000).tier.framesPerBucket).toBe(884);
    expect(decodeWaveformTierFor(bytes, 5000).tier.framesPerBucket).toBe(1323);
    expect(decodeWaveformTierFor(bytes, 300).tier.framesPerBucket).toBe(221);
  });

  it('falls back to the finest tier when zoomed in past it', () => {
    expect(decodeWaveformTierFor(bytes, 10).tier.framesPerBucket).toBe(221);
  });

  it('returns exactly that tier’s peaks, and the header', () => {
    const decoded = decodeWaveformTierFor(bytes, 1000);
    expect([...decoded.tier.peaks]).toEqual([-3, 3, -4, 4, -5, 5]);
    expect(decoded).toMatchObject({ channels: 2, sampleRateHz: 44_100, frameCount: 1_323_000 });
    expect(decodeWaveform(bytes).tiers[1]?.peaks).toEqual(decoded.tier.peaks);
  });

  it('refuses a malformed file rather than cutting a tier from it', () => {
    expect(() => decodeWaveformTierFor(bytes.subarray(0, bytes.length - 1), 1000)).toThrow(
      WaveformFormatError,
    );
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);
    expect(() => decodeWaveformTierFor(trailing, 1000)).toThrow(/trailing/);
  });
});
