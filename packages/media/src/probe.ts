/**
 * What a file actually is, according to ffprobe.
 *
 * The client's claims have already been discarded by this point — `sniff.ts` decided the content
 * type from magic bytes at upload, and this decides duration, codec and sample format from the
 * container. Both exist for the same reason: what someone says they uploaded is not evidence.
 *
 * **ffprobe output is parsed with Zod, not read with dot access.** Its JSON shape varies by
 * build, by container and by file: `duration` is absent on some streams and present as a string
 * on others, `bits_per_sample` is `0` for every compressed codec, and a damaged file can produce
 * a `streams` array with entries missing fields that are documented as always present. Unchecked
 * field access is how this breaks on one unusual file a year from now, in a job nobody is
 * watching, on someone's master.
 */
import { resolve } from 'node:path';

import { z } from 'zod';

import { ffprobePath, run, ToolError, type RunOptions } from './run';

/**
 * ffprobe reports numbers as strings, sometimes absent, occasionally `"N/A"`.
 *
 * Coercing here rather than at each use keeps the "is this a number" question in one place. A
 * value that cannot be read becomes `null`, never `0` — a zero duration and an unknown duration
 * are different facts, and conflating them would let a corrupt file look like an empty one.
 */
const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const streamSchema = z.object({
  codec_type: z.string().nullish(),
  codec_name: z.string().nullish(),
  sample_rate: numeric,
  channels: z.number().int().nullish(),
  bits_per_sample: numeric,
  bits_per_raw_sample: numeric,
  duration: numeric,
});

const formatSchema = z.object({
  format_name: z.string().nullish(),
  duration: numeric,
  bit_rate: numeric,
  size: numeric,
});

/** Deliberately permissive about *extra* keys and strict about the ones we read. */
export const ffprobeOutputSchema = z.object({
  streams: z.array(streamSchema).default([]),
  format: formatSchema.optional(),
});

export interface AudioProbe {
  readonly durationMs: number;
  readonly codec: string;
  readonly channels: number;
  readonly sampleRateHz: number;
  /** Null for every compressed codec — AAC has no meaningful bit depth. */
  readonly bitDepth: number | null;
  /** The container, as ffprobe names it (`wav`, `mov,mp4,m4a,3gp,3g2,mj2`). */
  readonly formatName: string | null;
  readonly bitRate: number | null;
  /** How many audio streams the file holds. More than one is unusual and worth surfacing. */
  readonly audioStreamCount: number;
}

/** Why a file is not usable audio. Set where the condition is known, never inferred later. */
export type NotAudioKind = 'not_media' | 'no_audio_stream' | 'no_codec' | 'no_duration';

/**
 * The probe ran, but the file is not something this product can treat as audio.
 *
 * Carries a `kind` as well as prose. The prose is for a person and includes an excerpt of
 * ffprobe's stderr; callers classify on `kind`. `validateAudio` used to substring-match the
 * message for `'no audio stream'` and `'duration'`, and ffprobe puts **the file's own path** in
 * that first stderr line — so a non-media file at a path containing the word `duration` was
 * reported as "contains a header but no audio". Found in review.
 */
export class NotAudioError extends Error {
  constructor(
    readonly kind: NotAudioKind,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'NotAudioError';
  }
}

/**
 * ffprobe's stderr, made safe to show someone and to store.
 *
 * Bounded and stripped of control characters: it is unbounded output that can carry escape
 * sequences, and it is documented as reaching a screen.
 */
export function sanitizeToolMessage(text: string, limit = 200): string {
  const firstLine = text.split('\n')[0] ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = firstLine.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

/**
 * Probe a file on disk.
 *
 * `-v error` keeps ffprobe's banner and warnings out of stdout so the JSON parse is not fighting
 * the logger. `-show_format -show_streams` is the minimum that answers every question here;
 * asking for less means a second invocation, and asking for more means more to validate.
 *
 * The path is passed after `--` style separation by position: it is the last argument and is
 * never concatenated into any other. See `run.ts` for why that matters.
 */
export async function probeAudio(path: string, options: RunOptions = {}): Promise<AudioProbe> {
  // **Absolute, always.** A relative path beginning `-` is consumed as an option rather than a
  // filename: `ffprobe … -loglevel.wav` fails with "Missing argument for option 'loglevel.wav'".
  // A test named for that case passed anyway, because the helper that built it produced an
  // absolute path — it asserted a control that was not there (found in review). `--` is not the
  // portable fix: ffprobe honours it, ffmpeg does not honour it before an option value.
  const target = resolve(path);

  let stdout: string;
  try {
    stdout = await run(
      ffprobePath(),
      [
        '-v',
        'error',
        // Defence in depth. A container can name external references — HLS playlists, concat
        // lists, QuickTime data references — and ffmpeg's defaults happen to refuse them when the
        // outer input is `file:`. Inheriting a property is not asserting it, and nothing here
        // pins a minimum ffmpeg version.
        '-protocol_whitelist',
        'file',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        target,
      ],
      options,
    );
  } catch (error) {
    // A non-zero exit from ffprobe on a file that exists means it could not be demuxed at all —
    // a text file, a truncated header, a ZIP. That is a rejection, not an infrastructure fault,
    // and the caller needs to tell those apart.
    if (error instanceof ToolError && error.reason === 'failed') {
      throw new NotAudioError(
        'not_media',
        `ffprobe could not read this file as media${
          error.stderr === '' ? '' : `: ${sanitizeToolMessage(error.stderr)}`
        }`,
      );
    }
    throw error;
  }

  let parsed: z.infer<typeof ffprobeOutputSchema>;
  try {
    parsed = ffprobeOutputSchema.parse(JSON.parse(stdout));
  } catch {
    throw new NotAudioError('not_media', 'ffprobe returned output this build could not interpret');
  }

  const audioStreams = parsed.streams.filter((stream) => stream.codec_type === 'audio');
  const stream = audioStreams[0];

  if (stream === undefined) {
    // A JPEG probes perfectly well and has no audio stream. So does a video with the audio track
    // stripped. Both are "not audio" rather than "corrupt".
    throw new NotAudioError('no_audio_stream', 'the file contains no audio stream');
  }

  const codec = stream.codec_name;
  if (codec === null || codec === undefined || codec === '') {
    throw new NotAudioError('no_codec', 'the audio stream does not name a codec');
  }

  const sampleRateHz = stream.sample_rate;
  if (sampleRateHz === null || sampleRateHz <= 0) {
    throw new NotAudioError('no_codec', 'the audio stream does not report a usable sample rate');
  }

  const channels = stream.channels;
  if (channels === null || channels === undefined || channels <= 0) {
    throw new NotAudioError('no_codec', 'the audio stream does not report a channel count');
  }

  // Container duration first: for a compressed stream it is the authoritative one, and a stream
  // may omit its own. Falling back the other way round reports the length of one track in a file
  // that has several.
  const seconds = parsed.format?.duration ?? stream.duration;
  if (seconds === null || seconds === undefined) {
    throw new NotAudioError('no_duration', 'the file does not report a duration');
  }

  return {
    durationMs: Math.round(seconds * 1000),
    codec,
    channels,
    sampleRateHz,
    bitDepth: bitDepthOf(stream),
    formatName: parsed.format?.format_name ?? null,
    bitRate: parsed.format?.bit_rate ?? null,
    audioStreamCount: audioStreams.length,
  };
}

/**
 * Bit depth, or `null` where the concept does not apply.
 *
 * ffprobe reports `bits_per_sample: 0` for AAC, Opus and every other compressed codec — the
 * value is not missing, it is meaningless, and `0` would be a lie in the database. FLAC and some
 * PCM variants report it only as `bits_per_raw_sample`, so both fields are consulted.
 */
function bitDepthOf(stream: z.infer<typeof streamSchema>): number | null {
  for (const candidate of [stream.bits_per_sample, stream.bits_per_raw_sample]) {
    if (candidate !== null && candidate !== undefined && candidate > 0) return candidate;
  }
  return null;
}
