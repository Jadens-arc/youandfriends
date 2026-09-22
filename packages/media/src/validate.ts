/**
 * Is this file something the pipeline can work on?
 *
 * Deliberately narrow. **Originals are sacred** (`docs/DESIGN.md`): this product's job is to hold
 * what someone uploaded, not to have opinions about it. So validation rejects what is genuinely
 * unusable — not media, no audio, no duration — and refuses the temptation to reject what is
 * merely unusual. A forty-minute ambient piece, a mono voice memo and an eight-channel stem
 * bounce are all real things people put in a music workspace.
 *
 * The one policy limit is duration, and it exists for resource reasons rather than taste: a
 * transcode costs roughly linear time in length, and something claiming to be twelve hours long
 * is either a mistake or an attempt to occupy a worker. It is generous, configurable, and says
 * so when it fires.
 */
import { NotAudioError, probeAudio, type AudioProbe } from './probe';
import { ToolError, type RunOptions } from './run';

/** Six hours. Longer than any plausible mix, far shorter than a denial-of-service. */
export const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export type ValidationFailure =
  'not_media' | 'no_audio_stream' | 'no_duration' | 'too_long' | 'unreadable';

export type ValidationResult =
  | { readonly ok: true; readonly probe: AudioProbe; readonly notes: readonly string[] }
  | { readonly ok: false; readonly failure: ValidationFailure; readonly reason: string };

export interface ValidateOptions extends RunOptions {
  readonly maxDurationMs?: number;
}

/**
 * Validate a file on disk.
 *
 * Returns a result rather than throwing for a rejected file, because a rejection is an ordinary
 * outcome the caller reports to a person — "this does not look like audio" belongs on screen, not
 * in an error log. A *broken environment* still throws: `ToolError` means ffprobe is missing or
 * timed out, which is not the uploader's fault and must not be recorded as their file being bad.
 */
export async function validateAudio(
  path: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  let probe: AudioProbe;

  try {
    probe = await probeAudio(path, options);
  } catch (error) {
    if (error instanceof NotAudioError) {
      // Switched on `kind`, never on the message. The message embeds ffprobe's stderr, which
      // contains the file's own path — so matching it for the word `duration` classified a
      // non-media file at `…/duration.wav` as "a header with no audio". Found in review.
      const failure: ValidationFailure = error.kind === 'no_codec' ? 'not_media' : error.kind;
      return { ok: false, failure, reason: error.reason };
    }

    // An environment fault is never the file's fault. Letting this become a rejection would
    // tell someone their master is corrupt because a worker lost its ffprobe.
    if (error instanceof ToolError) throw error;
    throw error;
  }

  if (probe.durationMs <= 0) {
    return {
      ok: false,
      failure: 'no_duration',
      reason: 'the file reports a duration of zero — it contains a header but no audio',
    };
  }

  const limit = options.maxDurationMs ?? MAX_DURATION_MS;
  if (probe.durationMs > limit) {
    return {
      ok: false,
      failure: 'too_long',
      reason:
        `the file is ${Math.round(probe.durationMs / 60_000)} minutes long, ` +
        `over the ${Math.round(limit / 60_000)} minute limit`,
    };
  }

  // Not rejections. Worth surfacing to whoever looks at the job, and worth *not* acting on
  // automatically: a file with two audio streams is unusual, and guessing which one is the song
  // is how the wrong take becomes the master.
  const notes: string[] = [];
  if (probe.audioStreamCount > 1) {
    notes.push(`contains ${probe.audioStreamCount} audio streams; the first was used`);
  }
  if (probe.channels > 2) {
    notes.push(`contains ${probe.channels} channels`);
  }

  return { ok: true, probe, notes };
}
