import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ffmpegPath, run } from '../run';
import { generateWav, type ToneSpec } from './tone';

/**
 * The media fixture catalog (task `066`): one generated file per class of input the pipeline has
 * to handle, and what the pipeline should learn from each.
 *
 * **Generated, never sourced, never real music** (`docs/THREAT_MODEL.md` T9). Every file is a
 * sine tone written by `generateWav` and, for the compressed formats, encoded by the same ffmpeg
 * the pipeline runs. Nothing here is committed as audio; `generate.mjs` writes the set to a
 * directory on demand, and the tests make their own.
 *
 * Tones are at 1 kHz on purpose: at 1 kHz the K-weighting filter's gain cancels the −0.691 dB
 * constant in ITU-R BS.1770, so a steady tone's integrated loudness is exactly computable —
 * {@link expectedLufs} — and a test compares against arithmetic rather than a remembered number.
 *
 * The seed's two WAVs (`packages/db/src/seed/fixtures/audio.ts`, task `027`) are the 44.1/16 and
 * 48/24 rows here in shape; the seed writes WAV only and cannot import this package
 * (`docs/ARCHITECTURE.md` §3), so the catalog is the canonical list and the seed follows it.
 */

export type FixtureContainer = 'wav' | 'flac' | 'mp3' | 'm4a' | 'aiff';

export interface MediaFixture {
  readonly name: string;
  readonly container: FixtureContainer;
  readonly tone: ToneSpec;
  /** ffmpeg arguments that turn the generated WAV into this container. Empty for WAV itself. */
  readonly encode: readonly string[];
  readonly expect: {
    readonly codec: string;
    readonly sampleRateHz: number;
    readonly channels: number;
    /** `null` for lossy codecs, which have no bit depth. */
    readonly bitDepth: number | null;
    /** Why loudness is unavailable, when it should be. */
    readonly loudnessUnavailable: 'silent' | 'too_short' | null;
    /** Encoders pad; lossy durations are compared more loosely than PCM ones. */
    readonly durationToleranceMs: number;
  };
}

const TONE_HZ = 1000;

function tone(overrides: Partial<ToneSpec> = {}): ToneSpec {
  return {
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    seconds: 5,
    toneHz: TONE_HZ,
    amplitude: 0.5,
    ...overrides,
  };
}

export const MEDIA_FIXTURES: readonly MediaFixture[] = [
  {
    name: 'tone-44100-16.wav',
    container: 'wav',
    tone: tone(),
    encode: [],
    expect: {
      codec: 'pcm_s16le',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: 16,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
  {
    name: 'tone-48000-24.wav',
    container: 'wav',
    tone: tone({ sampleRateHz: 48_000, bitDepth: 24, amplitude: 0.25 }),
    encode: [],
    expect: {
      codec: 'pcm_s24le',
      sampleRateHz: 48_000,
      channels: 2,
      bitDepth: 24,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
  {
    name: 'tone-48000-24.flac',
    container: 'flac',
    tone: tone({ sampleRateHz: 48_000, bitDepth: 24 }),
    encode: ['-c:a', 'flac'],
    expect: {
      codec: 'flac',
      sampleRateHz: 48_000,
      channels: 2,
      bitDepth: 24,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
  {
    name: 'tone-44100.mp3',
    container: 'mp3',
    tone: tone(),
    encode: ['-c:a', 'libmp3lame', '-b:a', '192k'],
    expect: {
      codec: 'mp3',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: null,
      loudnessUnavailable: null,
      durationToleranceMs: 100,
    },
  },
  {
    name: 'tone-44100.m4a',
    container: 'm4a',
    tone: tone(),
    encode: ['-c:a', 'aac', '-b:a', '192k'],
    expect: {
      codec: 'aac',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: null,
      loudnessUnavailable: null,
      durationToleranceMs: 100,
    },
  },
  {
    name: 'tone-44100-16.aiff',
    container: 'aiff',
    tone: tone(),
    encode: ['-c:a', 'pcm_s16be'],
    expect: {
      codec: 'pcm_s16be',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: 16,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
  {
    name: 'tone-mono-44100-16.wav',
    container: 'wav',
    tone: tone({ channels: 1 }),
    encode: [],
    expect: {
      codec: 'pcm_s16le',
      sampleRateHz: 44_100,
      channels: 1,
      bitDepth: 16,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
  {
    name: 'silence-44100-16.wav',
    container: 'wav',
    tone: tone({ amplitude: 0 }),
    encode: [],
    expect: {
      codec: 'pcm_s16le',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: 16,
      loudnessUnavailable: 'silent',
      durationToleranceMs: 5,
    },
  },
  {
    name: 'short-44100-16.wav',
    container: 'wav',
    tone: tone({ seconds: 0.5 }),
    encode: [],
    expect: {
      codec: 'pcm_s16le',
      sampleRateHz: 44_100,
      channels: 2,
      bitDepth: 16,
      loudnessUnavailable: 'too_short',
      durationToleranceMs: 5,
    },
  },
  {
    // "Very long", within reason for a test run: three minutes, generated at test time. Mono
    // 22.05 kHz keeps it to ~8 MB on disk while still exercising the long-file paths — the
    // multi-fragment derivative and the peaks tiers' bucket merging.
    name: 'long-mono-22050-16.wav',
    container: 'wav',
    tone: tone({ sampleRateHz: 22_050, channels: 1, seconds: 180 }),
    encode: [],
    expect: {
      codec: 'pcm_s16le',
      sampleRateHz: 22_050,
      channels: 1,
      bitDepth: 16,
      loudnessUnavailable: null,
      durationToleranceMs: 5,
    },
  },
];

/**
 * Integrated loudness of a steady 1 kHz tone, per ITU-R BS.1770: the mean square of a sine of
 * peak `a` is a²/2, summed over channels with weight 1 each, and at 1 kHz the K-filter's gain
 * cancels the −0.691 offset. So `10·log10(channels · a² / 2)`.
 */
export function expectedLufs(spec: ToneSpec): number | null {
  const amplitude = spec.amplitude ?? 0.5;
  if (amplitude === 0) return null;
  return 10 * Math.log10((spec.channels * amplitude * amplitude) / 2);
}

/** Write one fixture into `dir`. Returns its path. */
export async function writeFixture(fixture: MediaFixture, dir: string): Promise<string> {
  const wav = generateWav(fixture.tone);
  const path = join(dir, fixture.name);
  if (fixture.container === 'wav') {
    await writeFile(path, wav, { flag: 'wx' });
    return path;
  }
  const source = join(dir, `${fixture.name}.source.wav`);
  await writeFile(source, wav, { flag: 'wx' });
  await run(
    ffmpegPath(),
    ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-i', source, ...fixture.encode, path],
    { timeoutMs: 120_000 },
  );
  return path;
}
