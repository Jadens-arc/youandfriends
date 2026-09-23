/**
 * EBU R128 loudness and true peak (task `061`).
 *
 * One ffmpeg pass through the `ebur128` filter with true-peak measurement, reading the summary it
 * prints at the end. **Measured on the original**, never the streaming derivative: the
 * derivative's loudness is the encoder's, not the mix's, and the whole point of the number is to
 * compare mixes. Nothing is altered — measurement only (ADR 0004: originals untouched).
 *
 * The awkward cases are handled here rather than discovered in the UI:
 *
 *   - **Digital silence.** R128 gates out everything below −70 LUFS, so silence reports the gate
 *     floor as "integrated loudness" and `-inf` as its peak. Neither is a loudness. Both become
 *     `null`, with the reason.
 *   - **Very short files.** Integrated loudness is built from 400 ms blocks and settles over the
 *     3 s short-term window; below that the figure is noise. Reported unavailable, not as a
 *     number that looks authoritative.
 *   - **Mono, and unusual sample rates.** The filter handles both itself (it upsamples to 192 kHz
 *     internally for true peak); nothing here assumes stereo or 44.1/48 kHz.
 */
import { ffmpegPath, runForOutput, ToolError, type RunOptions } from './run';

/** Shorter than this and the integrated figure is not a measurement of anything. */
export const MIN_MEASURABLE_MS = 3_000;
/** The R128 absolute gate. At or below it, nothing was loud enough to count. */
export const ABSOLUTE_GATE_LUFS = -70;
/** A long master on slow disk. Measurement reads every sample once. */
export const LOUDNESS_TIMEOUT_MS = 15 * 60_000;

export type LoudnessUnavailable = 'silent' | 'too_short' | 'unreadable';

export interface LoudnessResult {
  /** Integrated loudness in LUFS, one decimal, or `null` when it is not a real measurement. */
  readonly integratedLufs: number | null;
  /** Maximum true peak across channels in dBTP, one decimal, or `null` (silence). */
  readonly truePeakDb: number | null;
  /** Loudness range in LU, when available. */
  readonly loudnessRangeLu: number | null;
  /** Why a value is missing — so the UI can say "silent" rather than showing nothing. */
  readonly unavailable: LoudnessUnavailable | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function readValue(summary: string, label: string): number | null {
  // `I:         -18.1 LUFS`, `Peak:       -3.0 dBFS`, `LRA:         0.0 LU`, or `-inf`.
  const match = summary.match(new RegExp(`\\b${label}:\\s+(-?inf|-?\\d+(?:\\.\\d+)?)`, 'i'));
  if (match === null) return null;
  const raw = match[1] as string;
  if (/inf/i.test(raw)) return Number.NEGATIVE_INFINITY;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse the `ebur128` summary from ffmpeg's stderr. Pure, so the edge cases are tested against
 * exact text as well as against real runs.
 */
export function parseEbur128Summary(stderr: string, durationMs: number | null): LoudnessResult {
  const at = stderr.lastIndexOf('Summary:');
  if (at === -1) {
    return {
      integratedLufs: null,
      truePeakDb: null,
      loudnessRangeLu: null,
      unavailable: 'unreadable',
    };
  }
  const summary = stderr.slice(at);
  const integrated = readValue(summary, 'I');
  const peak = readValue(summary, 'Peak');
  const range = readValue(summary, 'LRA');

  const silent =
    integrated === null ||
    !Number.isFinite(integrated) ||
    integrated <= ABSOLUTE_GATE_LUFS ||
    peak === Number.NEGATIVE_INFINITY;
  if (silent) {
    return { integratedLufs: null, truePeakDb: null, loudnessRangeLu: null, unavailable: 'silent' };
  }

  const truePeakDb = peak !== null && Number.isFinite(peak) ? round1(peak) : null;
  if (durationMs !== null && durationMs < MIN_MEASURABLE_MS) {
    // The peak is still a fact about the samples; the integrated figure is not a measurement.
    return { integratedLufs: null, truePeakDb, loudnessRangeLu: null, unavailable: 'too_short' };
  }
  return {
    integratedLufs: round1(integrated),
    truePeakDb,
    loudnessRangeLu: range !== null && Number.isFinite(range) ? round1(range) : null,
    unavailable: null,
  };
}

/**
 * Measure a file on disk. `durationMs` comes from the probe that already ran, so a too-short
 * file is identified without a second read.
 */
export async function measureLoudness(
  path: string,
  durationMs: number | null,
  options: RunOptions = {},
): Promise<LoudnessResult> {
  try {
    const { stderr } = await runForOutput(
      ffmpegPath(),
      [
        '-hide_banner',
        '-nostats',
        '-nostdin',
        '-i',
        path,
        '-map',
        '0:a:0',
        '-filter:a',
        'ebur128=peak=true:framelog=quiet',
        '-f',
        'null',
        '-',
      ],
      { ...options, timeoutMs: options.timeoutMs ?? LOUDNESS_TIMEOUT_MS },
    );
    return parseEbur128Summary(stderr, durationMs);
  } catch (error) {
    // A missing binary or a timeout is the worker's problem and must fail the job; a decode
    // failure on this file is a fact about the file.
    if (error instanceof ToolError && error.reason === 'failed') {
      return {
        integratedLufs: null,
        truePeakDb: null,
        loudnessRangeLu: null,
        unavailable: 'unreadable',
      };
    }
    throw error;
  }
}
