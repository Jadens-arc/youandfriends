/**
 * Waveform peaks (task `063`): min/max envelopes at several resolutions, in the compact binary
 * format `waveform-format.md` specifies and `@youandfriends/contracts` encodes and decodes.
 *
 * Computed from the **original**, decoded to 16-bit PCM at its own sample rate and channel count
 * — never from the lossy derivative, whose envelope is the encoder's, and never resampled, which
 * would shave off the peaks a waveform exists to show. ffmpeg streams the samples to us; nothing
 * the size of the decoded file is ever held in memory.
 *
 * **Deterministic.** Integer samples in, a fixed bucketing, and quantization with explicit
 * rounding — the same original always produces the same bytes, so a retried job cannot draw a
 * visibly different waveform for the same song.
 */
import { encodeWaveform, type WaveformPeaks, type WaveformTier } from '@youandfriends/contracts';

import { ffmpegPath, runStreaming, untrustedInput, type RunOptions } from './run';

/** The finest tier: buckets per second of audio. Enough for a zoomed-in loop edit. */
export const FINE_BUCKETS_PER_SECOND = 200;
/** A middle tier for a song-length view on a wide screen. */
export const MEDIUM_BUCKETS_PER_SECOND = 50;
/** The overview tier's size, whatever the length: a thumbnail's worth. */
export const OVERVIEW_BUCKETS = 1000;
export const WAVEFORM_TIMEOUT_MS = 15 * 60_000;

/** Quantize, rounding toward the extreme so quiet material is never drawn flatter than it is. */
const quantizeMin = (value: number) => Math.max(-127, Math.min(127, Math.floor(value * 127)));
const quantizeMax = (value: number) => Math.max(-127, Math.min(127, Math.ceil(value * 127)));

/** Merge adjacent fine buckets `factor` at a time. Pure; how the coarser tiers are built. */
export function mergeBuckets(mins: Float32Array, maxs: Float32Array, factor: number) {
  const count = Math.ceil(mins.length / factor);
  const outMin = new Float32Array(count);
  const outMax = new Float32Array(count);
  for (let bucket = 0; bucket < count; bucket += 1) {
    let low = 1;
    let high = -1;
    const end = Math.min(mins.length, (bucket + 1) * factor);
    for (let index = bucket * factor; index < end; index += 1) {
      low = Math.min(low, mins[index] as number);
      high = Math.max(high, maxs[index] as number);
    }
    outMin[bucket] = low;
    outMax[bucket] = high;
  }
  return { mins: outMin, maxs: outMax };
}

function toTier(framesPerBucket: number, mins: Float32Array, maxs: Float32Array): WaveformTier {
  const peaks = new Int8Array(mins.length * 2);
  for (let bucket = 0; bucket < mins.length; bucket += 1) {
    peaks[bucket * 2] = quantizeMin(mins[bucket] as number);
    peaks[bucket * 2 + 1] = quantizeMax(maxs[bucket] as number);
  }
  return { framesPerBucket, peaks };
}

/**
 * Accumulates the finest tier from interleaved signed 16-bit samples, chunk by chunk — chunks may
 * split a sample or a frame anywhere, so the remainder carries over.
 */
export class PeakAccumulator {
  private readonly framesPerBucket: number;
  private mins: Float32Array = new Float32Array(1024);
  private maxs: Float32Array = new Float32Array(1024);
  private bucketCount = 0;
  private framesInBucket = 0;
  private currentMin = 1;
  private currentMax = -1;
  private channel = 0;
  private remainder: Buffer = Buffer.alloc(0);
  frameCount = 0;

  constructor(
    readonly sampleRateHz: number,
    readonly channels: number,
  ) {
    this.framesPerBucket = Math.max(1, Math.round(sampleRateHz / FINE_BUCKETS_PER_SECOND));
  }

  get fineFramesPerBucket(): number {
    return this.framesPerBucket;
  }

  private push(min: number, max: number) {
    if (this.bucketCount === this.mins.length) {
      const grow = (array: Float32Array) => {
        const next = new Float32Array(array.length * 2);
        next.set(array);
        return next;
      };
      this.mins = grow(this.mins);
      this.maxs = grow(this.maxs);
    }
    this.mins[this.bucketCount] = min;
    this.maxs[this.bucketCount] = max;
    this.bucketCount += 1;
  }

  write(chunk: Buffer) {
    const data = this.remainder.length === 0 ? chunk : Buffer.concat([this.remainder, chunk]);
    const usable = data.length - (data.length % 2);
    for (let offset = 0; offset < usable; offset += 2) {
      const sample = data.readInt16LE(offset) / 32768;
      if (sample < this.currentMin) this.currentMin = sample;
      if (sample > this.currentMax) this.currentMax = sample;
      this.channel += 1;
      if (this.channel === this.channels) {
        this.channel = 0;
        this.frameCount += 1;
        this.framesInBucket += 1;
        if (this.framesInBucket === this.framesPerBucket) {
          this.push(this.currentMin, this.currentMax);
          this.framesInBucket = 0;
          this.currentMin = 1;
          this.currentMax = -1;
        }
      }
    }
    this.remainder = data.subarray(usable);
  }

  /** Close the last partial bucket and build every tier. */
  finish(): WaveformPeaks {
    if (this.framesInBucket > 0) this.push(this.currentMin, this.currentMax);
    this.framesInBucket = 0;
    const mins = this.mins.subarray(0, this.bucketCount);
    const maxs = this.maxs.subarray(0, this.bucketCount);

    const fine = this.framesPerBucket;
    const mediumFactor = Math.max(
      1,
      Math.round(FINE_BUCKETS_PER_SECOND / MEDIUM_BUCKETS_PER_SECOND),
    );
    // Never finer than the medium tier: for a file under ~20 s, "about 1,000 buckets" is finer
    // than 50 per second, and an overview listed first but finer than the tier after it breaks
    // the format's coarsest-first order. Found by task `066`'s golden file. When it would equal
    // the medium tier it is left out rather than stored twice.
    const overviewFactor = Math.max(mediumFactor, Math.ceil(this.bucketCount / OVERVIEW_BUCKETS));
    const medium = mergeBuckets(mins, maxs, mediumFactor);
    const tiers = [];
    if (overviewFactor > mediumFactor) {
      const overview = mergeBuckets(mins, maxs, overviewFactor);
      tiers.push(toTier(fine * overviewFactor, overview.mins, overview.maxs));
    }
    tiers.push(toTier(fine * mediumFactor, medium.mins, medium.maxs), toTier(fine, mins, maxs));

    return {
      channels: this.channels,
      sampleRateHz: this.sampleRateHz,
      frameCount: this.frameCount,
      tiers,
    };
  }
}

/**
 * Generate peaks for a file, given what the probe learned about it. Returns the encoded bytes,
 * ready to store as a `waveform_peaks` derivative.
 */
export async function generateWaveformPeaks(
  path: string,
  probe: { readonly channels: number; readonly sampleRateHz: number },
  options: RunOptions = {},
): Promise<{ readonly bytes: Uint8Array; readonly peaks: WaveformPeaks }> {
  const accumulator = new PeakAccumulator(probe.sampleRateHz, probe.channels);
  await runStreaming(
    ffmpegPath(),
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      ...untrustedInput(path),
      '-map',
      '0:a:0',
      // Decoded as-is: the source's own rate and channel count, as 16-bit signed samples.
      '-ac',
      String(probe.channels),
      '-ar',
      String(probe.sampleRateHz),
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      'pipe:1',
    ],
    (chunk) => accumulator.write(chunk),
    { ...options, timeoutMs: options.timeoutMs ?? WAVEFORM_TIMEOUT_MS },
  );
  const peaks = accumulator.finish();
  return { bytes: encodeWaveform(peaks), peaks };
}
