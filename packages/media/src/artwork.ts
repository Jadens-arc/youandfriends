/**
 * Cover art renditions (task `069`).
 *
 * An artwork original is decoded by the same ffmpeg, through the same guarded input as audio
 * (`untrustedInput`, `docs/THREAT_MODEL.md` T12), and rendered as small square JPEGs. The original
 * is never modified and never served into a page; a grid of presigned full-resolution originals
 * would be slow, and would put a bearer URL for every original into the payload.
 *
 * Two things are checked before anything is decoded:
 *
 * - **What it is.** ffprobe must see a single still image in one of the three accepted codecs.
 *   Anything else — a video, an SVG, a document renamed `.jpg` — is refused.
 * - **How big it is.** Width × height from the header, against {@link MAX_ARTWORK_PIXELS}. A PNG
 *   can declare 100,000 × 100,000 pixels in a few kilobytes; decoding it is the decompression
 *   bomb, so the ceiling is enforced on the declared size, before the decoder allocates anything.
 *
 * Renditions carry **no metadata**: `-map_metadata -1` drops container metadata, and the MJPEG
 * encoder writes a bare JFIF header — no EXIF, so no GPS position from the phone that took it.
 * Known limitation: an EXIF orientation flag is not applied, so a phone photo stored sideways
 * with an orientation tag renders sideways. Cover art is ordinarily exported square and upright.
 */
import { access } from 'node:fs/promises';

import { z } from 'zod';

import { ffmpegPath, ffprobePath, run, ToolError, untrustedInput, type RunOptions } from './run';

/** 40 megapixels: comfortably above a 6000×6000 print-resolution cover, far below a bomb. */
export const MAX_ARTWORK_PIXELS = 40_000_000;

/** ffprobe's codec names for the image types in `ARTWORK_IMAGE_TYPES`. */
export const ARTWORK_CODECS = ['mjpeg', 'png', 'webp'] as const;

export const ARTWORK_TIMEOUT_MS = 60_000;

export type ArtworkRejection = 'not_image' | 'image_too_large';

export class ArtworkRejectedError extends Error {
  constructor(
    readonly kind: ArtworkRejection,
    message: string,
  ) {
    super(message);
    this.name = 'ArtworkRejectedError';
  }
}

export interface ArtworkProbe {
  readonly codec: (typeof ARTWORK_CODECS)[number];
  readonly width: number;
  readonly height: number;
}

const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        nb_frames: z.string().optional(),
      }),
    )
    .default([]),
  format: z.object({ format_name: z.string().optional() }).optional(),
});

/** Read an image's codec and declared dimensions without decoding its pixels. */
export async function probeArtwork(path: string, options: RunOptions = {}): Promise<ArtworkProbe> {
  let stdout: string;
  try {
    stdout = await run(
      ffprobePath(),
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        ...untrustedInput(path),
      ],
      { timeoutMs: ARTWORK_TIMEOUT_MS, ...options },
    );
  } catch (error) {
    if (error instanceof ToolError && error.reason === 'failed') {
      throw new ArtworkRejectedError('not_image', 'ffprobe could not read this file as an image');
    }
    throw error;
  }

  const parsed = probeSchema.safeParse(JSON.parse(stdout));
  if (!parsed.success) throw new ArtworkRejectedError('not_image', 'unreadable probe output');
  const streams = parsed.data.streams;
  const video = streams.filter((stream) => stream.codec_type === 'video');
  const [image] = video;
  // Exactly one picture and nothing else: an audio track, or a second stream, is not cover art.
  if (image === undefined || video.length !== 1 || streams.length !== 1) {
    throw new ArtworkRejectedError('not_image', 'the file is not a single still image');
  }
  const codec = ARTWORK_CODECS.find((name) => name === image.codec_name);
  if (codec === undefined) {
    throw new ArtworkRejectedError(
      'not_image',
      `images encoded as ${image.codec_name ?? 'unknown'} are not accepted`,
    );
  }
  const { width, height } = image;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    throw new ArtworkRejectedError('not_image', 'the image does not declare its size');
  }
  if (width * height > MAX_ARTWORK_PIXELS) {
    throw new ArtworkRejectedError(
      'image_too_large',
      `the image is ${width}×${height}, over the ${MAX_ARTWORK_PIXELS} pixel limit`,
    );
  }
  return { codec, width, height };
}

/**
 * One square rendition: scaled to cover `width`×`width` and centre-cropped, as a JPEG with no
 * metadata. Refuses to overwrite, like the audio derivative.
 */
export async function renderCoverRendition(
  input: string,
  output: string,
  width: number,
  options: RunOptions = {},
): Promise<void> {
  if (!Number.isInteger(width) || width < 16 || width > 2048) {
    throw new Error(`invalid rendition width ${width}`);
  }
  if (input === output) throw new Error('refusing to write a rendition over its original');
  if (
    await access(output).then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(`refusing to overwrite ${output}`);
  }
  await run(
    ffmpegPath(),
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-n',
      ...untrustedInput(input),
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:${width}:force_original_aspect_ratio=increase,crop=${width}:${width},format=yuvj420p`,
      '-map_metadata',
      '-1',
      '-c:v',
      'mjpeg',
      '-q:v',
      '3',
      '-f',
      'image2',
      output,
    ],
    { timeoutMs: ARTWORK_TIMEOUT_MS, ...options },
  );
}
