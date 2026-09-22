/**
 * Real files on a real disk, for tests that run real tools.
 *
 * Nothing here is committed: every fixture is generated per test run and removed afterwards
 * (CLAUDE.md §8). `encode` shells out to the same ffmpeg the pipeline uses, because there is no
 * honest way to hand-write an AAC frame and a compressed fixture is the only thing that proves
 * `bitDepth` is `null` rather than `0` for compressed codecs.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateWav, type ToneSpec } from '../fixtures/tone';
import { ffmpegPath, run } from '../run';

export interface Scratch {
  readonly dir: string;
  file(name: string, bytes: Uint8Array): Promise<string>;
  wav(name: string, spec: ToneSpec): Promise<string>;
  /** Transcode a source file with ffmpeg. Returns the new path. */
  encode(name: string, source: string, args: readonly string[]): Promise<string>;
  /** Synthesize a file with ffmpeg from a lavfi source, with no input file. */
  synthesize(name: string, args: readonly string[]): Promise<string>;
  cleanup(): Promise<void>;
}

export async function scratch(): Promise<Scratch> {
  const dir = await mkdtemp(join(tmpdir(), 'media-test-'));

  const file = async (name: string, bytes: Uint8Array) => {
    const path = join(dir, name);
    await writeFile(path, bytes);
    return path;
  };

  return {
    dir,
    file,
    wav: (name, spec) => file(name, generateWav(spec)),
    async encode(name, source, args) {
      const path = join(dir, name);
      await run(ffmpegPath(), ['-v', 'error', '-y', '-i', source, ...args, path], {
        timeoutMs: 60_000,
      });
      return path;
    },
    async synthesize(name, args) {
      const path = join(dir, name);
      await run(ffmpegPath(), ['-v', 'error', '-y', ...args, path], { timeoutMs: 60_000 });
      return path;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** 44.1/16 stereo: what a mixdown usually is. */
export const MIXDOWN: ToneSpec = {
  sampleRateHz: 44_100,
  bitDepth: 16,
  channels: 2,
  seconds: 2,
  toneHz: 440,
};

/** 48/24 stereo: what a session usually is. A different codec, deliberately. */
export const SESSION: ToneSpec = {
  sampleRateHz: 48_000,
  bitDepth: 24,
  channels: 2,
  seconds: 3,
  toneHz: 220,
};
