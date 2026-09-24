/**
 * The waveform peaks format (task `063`), shared by the generator (`packages/media`) and the
 * player's decoder (task `072`) so the two cannot drift. Specified in prose in
 * `packages/media/src/waveform-format.md`; this file is the executable version of that document.
 *
 * Little-endian throughout.
 *
 *   offset  size  field
 *   0       4     magic "YFWP"
 *   4       1     version (1)
 *   5       1     source channel count (informational; peaks are over all channels)
 *   6       2     tier count (u16)
 *   8       4     source sample rate, Hz (u32)
 *   12      4     source frame count, high 32 bits (u32)
 *   16      4     source frame count, low 32 bits (u32)
 *   20      8×n   tier table: per tier, frames per bucket (u32) and bucket count (u32)
 *   …       2×Σ   tier data, in table order: per bucket, min (i8) then max (i8)
 *
 * A bucket's min and max are the lowest and highest sample across every channel in its frames,
 * scaled from [-1, 1] to [-127, 127] and rounded toward the extreme (min floors, max ceils), so a
 * quiet passage never rounds to a flat line that the audio does not have.
 */

export const WAVEFORM_MAGIC = 'YFWP';
export const WAVEFORM_VERSION = 1;
export const WAVEFORM_HEADER_BYTES = 20;
export const WAVEFORM_CONTENT_TYPE = 'application/octet-stream';

export interface WaveformTier {
  /** How many source frames each bucket summarizes. */
  readonly framesPerBucket: number;
  /** Interleaved min, max per bucket, each in [-127, 127]. */
  readonly peaks: Int8Array;
}

export interface WaveformPeaks {
  readonly channels: number;
  readonly sampleRateHz: number;
  readonly frameCount: number;
  /** Coarsest first. */
  readonly tiers: readonly WaveformTier[];
}

export class WaveformFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaveformFormatError';
  }
}

export function encodeWaveform(peaks: WaveformPeaks): Uint8Array {
  const dataBytes = peaks.tiers.reduce((sum, tier) => sum + tier.peaks.byteLength, 0);
  const tableBytes = 8 * peaks.tiers.length;
  const buffer = new ArrayBuffer(WAVEFORM_HEADER_BYTES + tableBytes + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < 4; index += 1) bytes[index] = WAVEFORM_MAGIC.charCodeAt(index);
  view.setUint8(4, WAVEFORM_VERSION);
  view.setUint8(5, Math.min(255, peaks.channels));
  view.setUint16(6, peaks.tiers.length, true);
  view.setUint32(8, peaks.sampleRateHz, true);
  view.setUint32(12, Math.floor(peaks.frameCount / 2 ** 32), true);
  view.setUint32(16, peaks.frameCount >>> 0, true);

  let offset = WAVEFORM_HEADER_BYTES;
  for (const tier of peaks.tiers) {
    view.setUint32(offset, tier.framesPerBucket, true);
    view.setUint32(offset + 4, tier.peaks.byteLength / 2, true);
    offset += 8;
  }
  for (const tier of peaks.tiers) {
    bytes.set(
      new Uint8Array(tier.peaks.buffer, tier.peaks.byteOffset, tier.peaks.byteLength),
      offset,
    );
    offset += tier.peaks.byteLength;
  }
  return bytes;
}

/**
 * Parse peaks, refusing anything malformed rather than drawing nonsense. The input is served
 * data, so every length is checked against the buffer before it is used.
 */
export function decodeWaveform(input: ArrayBuffer | Uint8Array): WaveformPeaks {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < WAVEFORM_HEADER_BYTES) throw new WaveformFormatError('too short');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== WAVEFORM_MAGIC) throw new WaveformFormatError('not a waveform file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== WAVEFORM_VERSION) throw new WaveformFormatError(`unsupported version ${version}`);

  const channels = view.getUint8(5);
  const tierCount = view.getUint16(6, true);
  const sampleRateHz = view.getUint32(8, true);
  const frameCount = view.getUint32(12, true) * 2 ** 32 + view.getUint32(16, true);

  let offset = WAVEFORM_HEADER_BYTES;
  if (offset + tierCount * 8 > bytes.byteLength) throw new WaveformFormatError('truncated table');
  const table: { framesPerBucket: number; count: number }[] = [];
  for (let index = 0; index < tierCount; index += 1) {
    table.push({
      framesPerBucket: view.getUint32(offset, true),
      count: view.getUint32(offset + 4, true),
    });
    offset += 8;
  }

  const tiers: WaveformTier[] = [];
  for (const { framesPerBucket, count } of table) {
    const length = count * 2;
    if (offset + length > bytes.byteLength) throw new WaveformFormatError('truncated data');
    tiers.push({
      framesPerBucket,
      peaks: new Int8Array(
        bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length),
      ),
    });
    offset += length;
  }
  if (offset !== bytes.byteLength) throw new WaveformFormatError('trailing bytes');
  return { channels, sampleRateHz, frameCount, tiers };
}

/**
 * The tier to draw at a zoom level: the coarsest whose buckets are no wider than a pixel, so no
 * detail is thrown away; or, zoomed in past the finest tier, the finest there is.
 */
export function tierFor(peaks: WaveformPeaks, framesPerPixel: number): WaveformTier | null {
  const fitting = peaks.tiers.filter((tier) => tier.framesPerBucket <= framesPerPixel);
  const pool = fitting.length > 0 ? fitting : peaks.tiers;
  if (pool.length === 0) return null;
  return pool.reduce((best, tier) =>
    fitting.length > 0
      ? tier.framesPerBucket > best.framesPerBucket
        ? tier
        : best
      : tier.framesPerBucket < best.framesPerBucket
        ? tier
        : best,
  );
}
