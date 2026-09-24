import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probeCapabilities } from '../capabilities';
import {
  topLevelBoxes,
  transcodeArgs,
  transcodeStreamingDerivative,
  variantOf,
  type DerivativeRecipe,
} from '../derivative';
import { probeAudio } from '../probe';
import { MIXDOWN, scratch, SESSION, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

describe('transcodeArgs', () => {
  it('reads the original as input only, never overwrites, and takes the configured bitrate', () => {
    const args = transcodeArgs('/in/original.wav', '/out/stream.m4a', {
      bitrate: '256k',
      encoder: 'aac',
    });
    expect(args.at(-1)).toBe('/out/stream.m4a');
    expect(args.filter((arg) => arg === '/in/original.wav')).toHaveLength(1);
    expect(args[args.indexOf('-i') + 1]).toBe('/in/original.wav');
    expect(args).toContain('-n');
    expect(args).not.toContain('-y');
    expect(args[args.indexOf('-b:a') + 1]).toBe('256k');
    expect(args[args.indexOf('-movflags') + 1]).toContain('+faststart');
    expect(args[args.indexOf('-movflags') + 1]).toContain('empty_moov');
    expect(() => transcodeArgs('a', 'b', { bitrate: '192k; rm -rf /', encoder: 'aac' })).toThrow();
  });

  it('labels the variant by recipe, so other derivatives can sit beside it', () => {
    expect(variantOf({ bitrate: '192k', encoder: 'aac' })).toBe('aac-192k');
  });

  it('refuses to write over its own input', async () => {
    await expect(
      transcodeStreamingDerivative('/x.wav', '/x.wav', { bitrate: '192k', encoder: 'aac' }),
    ).rejects.toThrow(/over its original/);
  });
});

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('streaming derivative', reason);

const sha256 = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

// Real ffmpeg transcodes: under a full parallel `pnpm test` one can take several seconds, which
// the 5-second default mistook for a hang. The fixtures are seconds of generated tone.
describeWithFfmpeg('transcoding the streaming derivative', { timeout: 30_000 }, () => {
  let files: Scratch;
  let recipe: DerivativeRecipe;

  beforeAll(async () => {
    files = await scratch();
    const capabilities = await probeCapabilities();
    recipe = { bitrate: '192k', encoder: capabilities.aacEncoder ?? 'aac' };
  });

  afterAll(async () => {
    await files.cleanup();
  });

  it('produces 44.1 kHz stereo AAC, the index first, and leaves the original byte-identical', async () => {
    const original = await files.wav('session.wav', { ...SESSION, seconds: 6 });
    const before = await sha256(original);
    const output = join(files.dir, 'stream.m4a');

    await transcodeStreamingDerivative(original, output, recipe);

    expect(await sha256(original)).toBe(before);
    const probe = await probeAudio(output);
    expect(probe).toMatchObject({
      codec: 'aac',
      channels: 2,
      sampleRateHz: 44_100,
      bitDepth: null,
    });
    expect(Math.abs(probe.durationMs - 6_000)).toBeLessThan(100);
    // `moov` before any media: playback can begin from the first bytes.
    const boxes = topLevelBoxes(new Uint8Array(await readFile(output)));
    expect(boxes[0]).toBe('ftyp');
    expect(boxes[1]).toBe('moov');
    // Fragmented: media in `moof`/`mdat` pairs, which is what makes byte-range seeking cheap.
    expect(boxes.slice(2)).toContain('moof');
  });

  it('downmixes surround to stereo and resamples an unusual rate', async () => {
    const surround = await files.synthesize('surround.wav', [
      '-f',
      'lavfi',
      '-i',
      ['sine=frequency=440', 'sample_rate=96000', 'duration=3'].join(':'),
      '-filter_complex',
      '[0:a]pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0[a]',
      '-map',
      '[a]',
      '-c:a',
      'pcm_s24le',
    ]);
    expect((await probeAudio(surround)).channels).toBe(6);

    const output = join(files.dir, 'surround.m4a');
    await transcodeStreamingDerivative(surround, output, recipe);
    expect(await probeAudio(output)).toMatchObject({ channels: 2, sampleRateHz: 44_100 });
  });

  it('refuses to overwrite an existing output rather than clobbering it', async () => {
    const original = await files.wav('again.wav', MIXDOWN);
    const output = join(files.dir, 'exists.m4a');
    await transcodeStreamingDerivative(original, output, recipe);
    const before = await sha256(output);
    await expect(transcodeStreamingDerivative(original, output, recipe)).rejects.toThrow(
      /overwrite/,
    );
    expect(await sha256(output)).toBe(before);
  });

  it('holds the bitrate near what was configured', async () => {
    const original = await files.wav('rate.wav', { ...MIXDOWN, seconds: 8 });
    const low = join(files.dir, 'low.m4a');
    const high = join(files.dir, 'high.m4a');
    await transcodeStreamingDerivative(original, low, { ...recipe, bitrate: '96k' });
    await transcodeStreamingDerivative(original, high, { ...recipe, bitrate: '256k' });
    const size = async (path: string) => (await readFile(path)).byteLength;
    expect(await size(high)).toBeGreaterThan((await size(low)) * 1.5);
  });
});
