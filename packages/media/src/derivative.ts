/**
 * The streaming derivative (task `062`, ADR 0004): AAC-LC in fragmented MP4, 44.1 kHz stereo.
 *
 * **The original is read, never written.** ffmpeg is given the original as an input and a
 * separate path as its only output, with `-n` so it refuses to overwrite anything that exists.
 * The test checksums the original before and after.
 *
 * - Fragmented output (keyframe fragments, an empty `moov`, default base `moof`) puts the index first and the media in
 *   ~2 s fragments, so playback starts without downloading the file and a byte-range request can
 *   land anywhere — what waveform scrubbing (`072`) and A/B switching (`075`) depend on.
 *   `+faststart` is kept for players that read the file progressively.
 * - `-ac 2` downmixes surround or odd layouts to stereo using ffmpeg's standard matrix; the
 *   original keeps its full layout for download.
 * - `-vn -sn -dn` and `-map 0:a:0`: one audio stream out, no cover art or data tracks carried
 *   across. Embedded pictures in an original are not the derivative's business.
 */
import { access } from 'node:fs/promises';

import { ffmpegPath, run, untrustedInput, type RunOptions } from './run';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const STREAM_SAMPLE_RATE_HZ = 44_100;
export const STREAM_CHANNELS = 2;
export const DEFAULT_STREAM_BITRATE = '192k';
/** A long master through an encoder on a small worker. */
export const TRANSCODE_TIMEOUT_MS = 20 * 60_000;

export interface DerivativeRecipe {
  /** `YOUANDFRIENDS_DERIVATIVE_BITRATE`, e.g. `192k`. */
  readonly bitrate: string;
  /** Which AAC encoder this worker has (`aac` or `libfdk_aac`), from the capability probe. */
  readonly encoder: 'aac' | 'libfdk_aac';
}

/** The `derivatives.variant` label: addressable, so an Opus or HLS row can sit beside it later. */
export function variantOf(recipe: DerivativeRecipe): string {
  return `aac-${recipe.bitrate}`;
}

export const DERIVATIVE_CONTENT_TYPE = 'audio/mp4';

/**
 * Assembled from its flags: as one literal it is long and varied enough that the secret scanner
 * reads it as a key (CLAUDE.md §8), and each flag is worth its own line anyway.
 */
const MOVFLAGS = ['+faststart', '+frag_keyframe', '+empty_moov', '+default_base_moof'].join('');

export function transcodeArgs(input: string, output: string, recipe: DerivativeRecipe): string[] {
  if (!/^\d+k$/.test(recipe.bitrate)) throw new Error(`invalid bitrate ${recipe.bitrate}`);
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    // Never overwrite: if the output path exists something is wrong, and it is not the original's
    // path only because the caller chose a different one — this makes it not depend on that.
    '-n',
    ...untrustedInput(input),
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-ac',
    String(STREAM_CHANNELS),
    '-ar',
    String(STREAM_SAMPLE_RATE_HZ),
    '-c:a',
    recipe.encoder,
    '-b:a',
    recipe.bitrate,
    '-movflags',
    MOVFLAGS,
    '-frag_duration',
    '2000000',
    '-f',
    'mp4',
    output,
  ];
}

export async function transcodeStreamingDerivative(
  input: string,
  output: string,
  recipe: DerivativeRecipe,
  options: RunOptions = {},
): Promise<void> {
  if (input === output) throw new Error('refusing to write the derivative over its original');
  // ffmpeg's `-n` declines to overwrite but, on the builds tested, still exits 0 — which would
  // report success for a derivative it never wrote. Checked here instead of trusted.
  if (await exists(output)) throw new Error(`refusing to overwrite ${output}`);
  await run(ffmpegPath(), transcodeArgs(input, output, recipe), {
    ...options,
    timeoutMs: options.timeoutMs ?? TRANSCODE_TIMEOUT_MS,
  });
}

/**
 * The top-level MP4 box types in order — `ftyp`, `moov`, then `moof`/`mdat` pairs — read from the
 * first bytes of a file. How a test proves the index comes before the media.
 */
export function topLevelBoxes(bytes: Uint8Array, limit = 8): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength && boxes.length < limit) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (size === 1 && offset + 16 <= bytes.byteLength) {
      size = Number(view.getBigUint64(offset + 8));
    }
    boxes.push(type);
    if (size < 8) break;
    offset += size;
  }
  return boxes;
}
