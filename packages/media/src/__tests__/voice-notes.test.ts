import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probeCapabilities } from '../capabilities';
import { transcodeStreamingDerivative, type DerivativeRecipe } from '../derivative';
import { measureLoudness } from '../loudness';
import { sniffContentType, SNIFF_PREFIX_BYTES } from '../sniff';
import { validateAudio } from '../validate';
import { generateWaveformPeaks } from '../waveform';
import { scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('browser voice notes', reason);

/**
 * Voice notes as browsers actually record them (task `093`): Chrome and Firefox write WebM with
 * Opus, Safari writes MP4 with AAC — mono, at the microphone's rate. Both must go through the
 * same pipeline as music, to a streaming derivative and a waveform. The recordings are generated
 * here with ffmpeg in those containers and codecs, a few seconds of tone (CLAUDE.md §8).
 */
describeWithFfmpeg('browser voice notes through the pipeline', { timeout: 30_000 }, () => {
  let files: Scratch;
  let encoder: DerivativeRecipe['encoder'];
  const recordings = {} as Record<'webm' | 'mp4', string>;

  beforeAll(async () => {
    files = await scratch();
    encoder = (await probeCapabilities()).aacEncoder ?? 'aac';
    const voice = [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=3',
      '-ac',
      '1',
      '-ar',
      '48000',
    ];
    recordings.webm = await files.synthesize('chrome.webm', [
      ...voice,
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
    ]);
    recordings.mp4 = await files.synthesize('safari.mp4', [...voice, '-c:a', 'aac', '-b:a', '64k']);
  });

  afterAll(async () => {
    await files?.cleanup();
  });

  it('recognises each container from its bytes', async () => {
    const prefix = async (path: string) =>
      new Uint8Array(await readFile(path)).subarray(0, SNIFF_PREFIX_BYTES);
    expect(sniffContentType(await prefix(recordings.webm))).toBe('audio/webm');
    // Safari's MP4 carries a generic brand: named MP4 all the same, and processed by what it is.
    expect(sniffContentType(await prefix(recordings.mp4))).toMatch(/\/mp4$/);
  });

  for (const format of ['webm', 'mp4'] as const) {
    it(`validates, transcodes, and draws a ${format} recording`, async () => {
      const path = recordings[format];
      const validation = await validateAudio(path);
      if (!validation.ok) throw new Error(`${format} refused: ${validation.reason}`);
      expect(validation.probe.channels).toBe(1);
      expect(Math.abs(validation.probe.durationMs - 3_000)).toBeLessThan(150);

      const output = join(files.dir, `${format}-stream.m4a`);
      await transcodeStreamingDerivative(path, output, { bitrate: '96k', encoder });
      expect((await readFile(output)).byteLength).toBeGreaterThan(1_000);

      const { peaks } = await generateWaveformPeaks(path, validation.probe);
      expect(peaks.tiers.length).toBeGreaterThan(0);

      const loudness = await measureLoudness(path, validation.probe.durationMs);
      expect(loudness).toBeDefined();
    });
  }
});
