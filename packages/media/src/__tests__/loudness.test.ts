import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIN_MEASURABLE_MS, measureLoudness, parseEbur128Summary } from '../loudness';
import { scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const SUMMARY = (integrated: string, peak: string, lra = '0.0') => `
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         ${integrated} LUFS
    Threshold: -28.2 LUFS

  Loudness range:
    LRA:         ${lra} LU
    Threshold:   0.0 LUFS

  True peak:
    Peak:       ${peak} dBFS
`;

describe('parseEbur128Summary', () => {
  it('reads integrated loudness, true peak, and range to one decimal', () => {
    expect(parseEbur128Summary(SUMMARY('-14.23', '-0.96', '6.44'), 180_000)).toEqual({
      integratedLufs: -14.2,
      truePeakDb: -1,
      loudnessRangeLu: 6.4,
      unavailable: null,
    });
  });

  it('turns digital silence into "silent", never -inf or the -70 gate floor', () => {
    const result = parseEbur128Summary(SUMMARY('-70.0', '-inf'), 60_000);
    expect(result).toEqual({
      integratedLufs: null,
      truePeakDb: null,
      loudnessRangeLu: null,
      unavailable: 'silent',
    });
    expect(JSON.stringify(result)).not.toMatch(/inf|null.*-70/);
  });

  it('marks a very short file unavailable while keeping its peak', () => {
    expect(parseEbur128Summary(SUMMARY('-20.1', '-6.0'), MIN_MEASURABLE_MS - 1)).toEqual({
      integratedLufs: null,
      truePeakDb: -6,
      loudnessRangeLu: null,
      unavailable: 'too_short',
    });
  });

  it('reads the last summary, and reports no summary as unreadable', () => {
    const twice = SUMMARY('-30.0', '-10.0') + SUMMARY('-12.0', '-1.0');
    expect(parseEbur128Summary(twice, 60_000).integratedLufs).toBe(-12);
    expect(parseEbur128Summary('garbage', 60_000).unavailable).toBe('unreadable');
  });
});

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('loudness measurement', reason);

/**
 * Real ffmpeg, generated tones (CLAUDE.md §8). A sine's true peak is its amplitude, so −6.02 dBFS
 * for the default half-scale tone; halving the amplitude lowers both peak and loudness by 6 dB.
 * Those relationships are what is asserted, within tolerance, rather than a magic LUFS figure.
 */
describeWithFfmpeg('measuring loudness with ffmpeg', () => {
  let files: Scratch;

  beforeAll(async () => {
    files = await scratch();
  });

  afterAll(async () => {
    await files.cleanup();
  });

  const tone = {
    sampleRateHz: 48_000,
    bitDepth: 24,
    channels: 2,
    seconds: 5,
    toneHz: 1000,
  } as const;

  it('measures a stereo tone: true peak at its amplitude, loudness in a sane range', async () => {
    const path = await files.wav('tone.wav', tone);
    const result = await measureLoudness(path, 5_000);
    expect(result.unavailable).toBeNull();
    expect(result.truePeakDb).toBeCloseTo(-6, 0);
    expect(result.integratedLufs).toBeGreaterThan(-12);
    expect(result.integratedLufs).toBeLessThan(-4);
  });

  it('sees half the amplitude as 6 dB quieter, in loudness and peak', async () => {
    const loud = await measureLoudness(await files.wav('loud.wav', tone), 5_000);
    const quiet = await measureLoudness(
      await files.wav('quiet.wav', { ...tone, amplitude: 0.25 }),
      5_000,
    );
    expect((loud.integratedLufs ?? 0) - (quiet.integratedLufs ?? 0)).toBeCloseTo(6, 0);
    expect((loud.truePeakDb ?? 0) - (quiet.truePeakDb ?? 0)).toBeCloseTo(6, 0);
  });

  it('handles mono and an unusual sample rate', async () => {
    const mono = await measureLoudness(
      await files.wav('mono.wav', { ...tone, channels: 1, sampleRateHz: 22_050, bitDepth: 16 }),
      5_000,
    );
    expect(mono.unavailable).toBeNull();
    expect(mono.truePeakDb).toBeCloseTo(-6, 0);
    // One channel carries half the power of two identical ones: about 3 dB quieter.
    const stereo = await measureLoudness(await files.wav('stereo.wav', tone), 5_000);
    expect((stereo.integratedLufs ?? 0) - (mono.integratedLufs ?? 0)).toBeCloseTo(3, 0);
  });

  it('reports digital silence as silent, not as a number', async () => {
    const result = await measureLoudness(
      await files.wav('silence.wav', { ...tone, amplitude: 0 }),
      5_000,
    );
    expect(result).toEqual({
      integratedLufs: null,
      truePeakDb: null,
      loudnessRangeLu: null,
      unavailable: 'silent',
    });
  });

  it('refuses to give a short file an integrated figure', async () => {
    const result = await measureLoudness(
      await files.wav('short.wav', { ...tone, seconds: 1 }),
      1_000,
    );
    expect(result.unavailable).toBe('too_short');
    expect(result.integratedLufs).toBeNull();
  });

  it('reports a file that will not decode as unreadable rather than failing the worker', async () => {
    const path = await files.file('broken.wav', new TextEncoder().encode('not audio at all'));
    expect((await measureLoudness(path, null)).unavailable).toBe('unreadable');
  });
});
