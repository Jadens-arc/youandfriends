import { createHash } from 'node:crypto';

import {
  decodeWaveform,
  encodeWaveform,
  tierFor,
  WaveformFormatError,
  type WaveformPeaks,
} from '@youandfriends/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probeAudio } from '../probe';
import {
  FINE_BUCKETS_PER_SECOND,
  MEDIUM_BUCKETS_PER_SECOND,
  generateWaveformPeaks,
  mergeBuckets,
  OVERVIEW_BUCKETS,
  PeakAccumulator,
} from '../waveform';
import { MIXDOWN, scratch, SESSION, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const SAMPLE: WaveformPeaks = {
  channels: 2,
  sampleRateHz: 48_000,
  frameCount: 2 ** 33 + 5,
  tiers: [
    { framesPerBucket: 960, peaks: Int8Array.from([-10, 12, -127, 127]) },
    { framesPerBucket: 240, peaks: Int8Array.from([-1, 1]) },
  ],
};

describe('the waveform format', () => {
  it('round-trips, including a frame count past 32 bits', () => {
    const decoded = decodeWaveform(encodeWaveform(SAMPLE));
    expect(decoded.frameCount).toBe(SAMPLE.frameCount);
    expect(decoded.sampleRateHz).toBe(48_000);
    expect(decoded.tiers.map((tier) => [tier.framesPerBucket, [...tier.peaks]])).toEqual([
      [960, [-10, 12, -127, 127]],
      [240, [-1, 1]],
    ]);
  });

  it('refuses a wrong magic, a future version, truncation, and trailing bytes', () => {
    const good = encodeWaveform(SAMPLE);
    const bad = (mutate: (bytes: Uint8Array) => Uint8Array) =>
      expect(() => decodeWaveform(mutate(good.slice()))).toThrow(WaveformFormatError);
    bad((bytes) => {
      bytes[0] = 0x58;
      return bytes;
    });
    bad((bytes) => {
      bytes[4] = 2;
      return bytes;
    });
    bad((bytes) => bytes.slice(0, bytes.length - 1));
    bad((bytes) => Uint8Array.from([...bytes, 0]));
    bad(() => new Uint8Array(4));
  });

  it('picks the coarsest tier no wider than a pixel, or the finest when zoomed past it', () => {
    expect(tierFor(SAMPLE, 1000)?.framesPerBucket).toBe(960);
    expect(tierFor(SAMPLE, 500)?.framesPerBucket).toBe(240);
    expect(tierFor(SAMPLE, 10)?.framesPerBucket).toBe(240);
  });
});

describe('PeakAccumulator', () => {
  const pcm = (samples: number[]) => {
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
    return buffer;
  };

  it('takes each bucket’s extremes across every channel', () => {
    // 400 Hz / 200 buckets per second = 2 frames per bucket; stereo interleaved.
    const accumulator = new PeakAccumulator(400, 2);
    accumulator.write(pcm([16384, -100, 0, -32768, 100, 200, 300, 400]));
    const { tiers, frameCount } = accumulator.finish();
    expect(frameCount).toBe(4);
    const fine = tiers.at(-1);
    expect(fine?.framesPerBucket).toBe(2);
    expect([...(fine?.peaks ?? [])]).toEqual([-127, 64, 0, 2]);
  });

  it('gives the same answer however the stream is split into chunks', () => {
    const samples = Array.from({ length: 4000 }, (_, index) =>
      Math.round(Math.sin(index / 7) * 20000),
    );
    const whole = new PeakAccumulator(4000, 1);
    whole.write(pcm(samples));
    const split = new PeakAccumulator(4000, 1);
    const bytes = pcm(samples);
    // Odd-sized chunks split samples mid-byte.
    for (let offset = 0; offset < bytes.length; offset += 333)
      split.write(bytes.subarray(offset, offset + 333));
    expect(encodeWaveform(split.finish())).toEqual(encodeWaveform(whole.finish()));
  });

  it('rounds toward the extreme, so quiet audio is never drawn flat', () => {
    const accumulator = new PeakAccumulator(200, 1);
    accumulator.write(pcm([10, -10]));
    expect([...(accumulator.finish().tiers.at(-1)?.peaks ?? [])]).toEqual([0, 1, -1, 0]);
  });

  it('merges buckets for the coarser tiers', () => {
    const merged = mergeBuckets(
      Float32Array.from([-0.1, -0.5, -0.2]),
      Float32Array.from([0.3, 0.1, 0.9]),
      2,
    );
    expect([...merged.mins]).toEqual([Math.fround(-0.5), Math.fround(-0.2)]);
    expect([...merged.maxs]).toEqual([Math.fround(0.3), Math.fround(0.9)]);
  });
});

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('waveform generation', reason);

describeWithFfmpeg('generating peaks with ffmpeg', () => {
  let files: Scratch;

  beforeAll(async () => {
    files = await scratch();
  });

  afterAll(async () => {
    await files.cleanup();
  });

  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  it('produces three tiers, coarsest first, matching the tone, deterministically', async () => {
    const path = await files.wav('mix.wav', { ...MIXDOWN, seconds: 30 });
    const probe = await probeAudio(path);
    const first = await generateWaveformPeaks(path, probe);
    const second = await generateWaveformPeaks(path, probe);
    expect(hash(first.bytes)).toBe(hash(second.bytes));

    const peaks = decodeWaveform(first.bytes);
    expect(peaks.frameCount).toBe(1_323_000);
    expect(peaks.tiers).toHaveLength(3);
    const sizes = peaks.tiers.map((tier) => tier.framesPerBucket);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(3);
    const fine = peaks.tiers[2];
    expect(fine?.framesPerBucket).toBe(Math.round(44_100 / FINE_BUCKETS_PER_SECOND));
    expect(fine?.peaks.length).toBe(2 * Math.ceil(1_323_000 / (fine?.framesPerBucket ?? 1)));
    expect(peaks.tiers[0]?.peaks.length).toBeLessThanOrEqual(2 * OVERVIEW_BUCKETS);
    // A half-scale sine: every bucket spans about ±64 (a 440 Hz cycle fits in a 5 ms bucket).
    const values = [...(fine?.peaks ?? [])];
    expect(Math.max(...values)).toBeGreaterThanOrEqual(63);
    expect(Math.max(...values)).toBeLessThanOrEqual(65);
    expect(Math.min(...values)).toBeLessThanOrEqual(-63);
    // Smaller than the same integers as JSON, and far smaller than JSON floats, which is what a
    // JSON peaks format would ordinarily carry.
    const allTiers = peaks.tiers.map((tier) => [...tier.peaks]);
    expect(first.bytes.byteLength * 2).toBeLessThan(JSON.stringify(allTiers).length);
    const asFloats = JSON.stringify(allTiers.map((tier) => tier.map((value) => value / 127)));
    expect(first.bytes.byteLength * 10).toBeLessThan(asFloats.length);
  });

  it('leaves out an overview that would be no coarser than the medium tier (a short file)', async () => {
    const path = await files.wav('short.wav', { ...MIXDOWN, seconds: 10 });
    const peaks = decodeWaveform((await generateWaveformPeaks(path, await probeAudio(path))).bytes);
    const fine = Math.round(44_100 / FINE_BUCKETS_PER_SECOND);
    // The medium tier is whole fine buckets merged, so its width is a multiple of the fine one.
    expect(peaks.tiers.map((tier) => tier.framesPerBucket)).toEqual([
      fine * (FINE_BUCKETS_PER_SECOND / MEDIUM_BUCKETS_PER_SECOND),
      fine,
    ]);
  });

  it('handles mono and multichannel sources with one envelope', async () => {
    const mono = await files.wav('mono.wav', { ...SESSION, channels: 1 });
    const monoPeaks = await generateWaveformPeaks(mono, await probeAudio(mono));
    expect(monoPeaks.peaks.channels).toBe(1);

    const surround = await files.synthesize('six.wav', [
      '-f',
      'lavfi',
      '-i',
      ['sine=frequency=220', 'sample_rate=48000', 'duration=2'].join(':'),
      '-filter_complex',
      '[0:a]pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0[a]',
      '-map',
      '[a]',
      '-c:a',
      'pcm_s16le',
    ]);
    const six = await generateWaveformPeaks(surround, await probeAudio(surround));
    expect(six.peaks.channels).toBe(6);
    expect(six.peaks.frameCount).toBe(96_000);
  });
});
