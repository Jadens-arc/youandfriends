/**
 * Asset and file contracts.
 *
 * There is exactly one **Project Files** area, organized by user-created folders and tags.
 * `project_file` is therefore a single kind — there is deliberately no Logic or MPC variant
 * (docs/DESIGN.md §2, and the confirmed amendment in §16).
 */

import { z } from 'zod';

export const ASSET_KINDS = [
  'master',
  'mix',
  'stem',
  'sample',
  'project_file',
  'artwork',
  'voice_note',
] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

/** Kinds that carry audio and therefore go through the media pipeline. */
export const AUDIO_ASSET_KINDS: readonly AssetKind[] = [
  'master',
  'mix',
  'stem',
  'sample',
  'voice_note',
];

export function isAudioKind(kind: AssetKind): boolean {
  return AUDIO_ASSET_KINDS.includes(kind);
}

/** Processing state of a version's derived media. Never conveyed by colour alone in the UI. */
export const PROCESSING_STATES = ['queued', 'running', 'complete', 'failed'] as const;
export const processingStateSchema = z.enum(PROCESSING_STATES);
export type ProcessingState = z.infer<typeof processingStateSchema>;

/** Technical metadata extracted from an audio original by ffprobe (task `060`). */
export const audioMetadataSchema = z.object({
  durationSeconds: z.number().positive(),
  codec: z.string().min(1),
  channels: z.number().int().positive(),
  sampleRate: z.number().int().positive(),
  bitDepth: z.number().int().positive().nullable(),
  /** EBU R128 integrated loudness. Null when the file is too short to measure reliably. */
  integratedLufs: z.number().nullable(),
  truePeakDbtp: z.number().nullable(),
});
export type AudioMetadata = z.infer<typeof audioMetadataSchema>;

/**
 * Why processing failed, as a person should read it (task `065`). The pipeline stores one of
 * these in `asset_versions.processing_error`; the tool output and paths behind it go to the job's
 * own log (`media_jobs.last_error`), never to the page. "ffprobe exited 1" is not an explanation.
 */
export const PROCESSING_FAILURE_MESSAGES = {
  not_media: 'This file doesn’t appear to be audio we can process.',
  no_audio_stream: 'This file doesn’t contain any audio.',
  no_duration: 'This file has no audio in it — it may be empty or cut short.',
  too_long: 'This recording is longer than the six-hour limit.',
  not_image: 'This file doesn’t appear to be a JPEG, PNG, or WebP image.',
  image_too_large: 'This image is too large to use as cover art.',
  unreadable: 'This file doesn’t appear to be audio we can process.',
  gave_up: 'We couldn’t finish processing this version.',
} as const;
export type ProcessingFailureKind = keyof typeof PROCESSING_FAILURE_MESSAGES;

/**
 * Cover art (task `069`): the image types an artwork original may be, and the square widths it
 * is rendered at. Renditions are JPEG derivatives named `cover-<width>`; the original is never
 * served into a page.
 */
export const ARTWORK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const COVER_RENDITION_WIDTHS = [128, 256, 512] as const;
export const COVER_RENDITION_TYPE = 'image/jpeg';

export function coverVariant(width: number): string {
  return `cover-${width}`;
}

/** `cover-256` → 256; anything else → null. */
export function coverWidthOf(variant: string): number | null {
  const match = /^cover-(\d+)$/.exec(variant);
  if (match === null) return null;
  const width = Number(match[1]);
  return (COVER_RENDITION_WIDTHS as readonly number[]).includes(width) ? width : null;
}
