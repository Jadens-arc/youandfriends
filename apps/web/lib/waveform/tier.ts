import { decodeWaveformTierFor } from '@youandfriends/contracts';

/**
 * Choosing and cutting the one tier a view needs (task `072`). Kept apart from `decode.ts`, and
 * the worker imports only this: a worker imported by the module that creates it forms a cycle
 * the bundler cannot resolve (found in task `053`).
 */
export interface DecodedTier {
  readonly channels: number;
  readonly sampleRateHz: number;
  readonly frameCount: number;
  readonly framesPerBucket: number;
  readonly peaks: Int8Array;
}

/**
 * The tier for a view `widthPx` pixels wide: frames per pixel come from the file's own header,
 * so a narrow compact view gets the coarse tier and never decodes full detail.
 */
export function tierForWidth(bytes: Uint8Array, widthPx: number): DecodedTier {
  // Reading the coarsest tier is cheap and yields the header.
  const probe = decodeWaveformTierFor(bytes, Number.POSITIVE_INFINITY);
  const framesPerPixel = probe.frameCount / Math.max(1, widthPx);
  const chosen = decodeWaveformTierFor(bytes, framesPerPixel);
  return {
    channels: chosen.channels,
    sampleRateHz: chosen.sampleRateHz,
    frameCount: chosen.frameCount,
    framesPerBucket: chosen.tier.framesPerBucket,
    peaks: chosen.tier.peaks,
  };
}
