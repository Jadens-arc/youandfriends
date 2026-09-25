import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeWaveform, encodeWaveform, WAVEFORM_MAGIC } from '@youandfriends/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateWav } from '../fixtures/tone';
import { generateWaveformPeaks } from '../waveform';
import { scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const GOLDEN = new URL('../fixtures/golden/tone-1k-1s.yfwp', import.meta.url);

/**
 * The waveform format, pinned (task `066`).
 *
 * `tone-1k-1s.yfwp` is committed — 536 bytes of peaks, not audio. It is what the generator
 * produced for a one-second 1 kHz mono tone when the format was fixed. The player's decoder
 * (task `072`) reads exactly these bytes, so an accidental change to either side of the format
 * — a field moved, a tier added, rounding changed — fails here by name rather than as a blank
 * waveform in someone's browser. Changing the format on purpose means a new version number and
 * a new golden file, deliberately.
 */
describe('the committed golden waveform', () => {
  it('still decodes to the layout the format document describes', async () => {
    const bytes = new Uint8Array(await readFile(GOLDEN));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe(WAVEFORM_MAGIC);
    const peaks = decodeWaveform(bytes);
    expect(peaks).toMatchObject({ channels: 1, sampleRateHz: 44_100, frameCount: 44_100 });
    // Two tiers, coarsest first: a one-second file has no separate overview (see the format
    // document). 884 frames is four fine buckets of 221.
    expect(peaks.tiers.map((tier) => [tier.framesPerBucket, tier.peaks.length / 2])).toEqual([
      [884, 50],
      [221, 200],
    ]);
    // Half scale: ±0.5 of full scale is ±64 of ±127, rounded toward the extreme.
    expect(Math.max(...peaks.tiers[1]!.peaks)).toBe(64);
    expect(Math.min(...peaks.tiers[1]!.peaks)).toBe(-64);
    // Re-encoding what was decoded reproduces the file exactly: nothing is lost or reordered.
    expect(encodeWaveform(peaks)).toEqual(bytes);
  });
});

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('golden waveform generation', reason);

describeWithFfmpeg('generating the golden waveform', () => {
  let files: Scratch;
  beforeAll(async () => {
    files = await scratch();
  });
  afterAll(async () => {
    await files?.cleanup();
  });

  it('produces the committed bytes for the committed input', async () => {
    const path = join(files.dir, 'tone.wav');
    await writeFile(
      path,
      generateWav({
        sampleRateHz: 44_100,
        bitDepth: 16,
        channels: 1,
        seconds: 1,
        toneHz: 1000,
        amplitude: 0.5,
      }),
    );
    const { bytes } = await generateWaveformPeaks(path, { channels: 1, sampleRateHz: 44_100 });
    expect(bytes).toEqual(new Uint8Array(await readFile(GOLDEN)));
  });
});
