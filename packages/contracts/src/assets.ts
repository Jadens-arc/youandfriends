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
