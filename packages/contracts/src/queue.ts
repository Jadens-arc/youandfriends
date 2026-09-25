import { z } from 'zod';

import { ulidSchema } from './ids';

/**
 * Building or restoring a playback queue (task `073`). The browser names what it wants by id —
 * never by URL — and the server answers with what this viewer may actually play.
 */
export const QUEUE_MAX_ITEMS = 500;

export const queueSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('versions'),
    versionIds: z.array(ulidSchema).max(QUEUE_MAX_ITEMS),
  }),
  z.object({ kind: z.literal('songs'), songIds: z.array(ulidSchema).min(1).max(QUEUE_MAX_ITEMS) }),
  z.object({ kind: z.literal('project'), projectId: ulidSchema }),
  z.object({ kind: z.literal('folder'), folderId: ulidSchema }),
]);
export type QueueSelection = z.infer<typeof queueSelectionSchema>;

/**
 * A loop region (task `074`), in whole milliseconds. Bounded by the longest audio the pipeline
 * accepts (six hours), so a stored region can never be absurd.
 */
export const LOOP_MAX_MS = 6 * 60 * 60 * 1000;

export const loopRegionSchema = z
  .object({
    startMs: z.number().int().min(0).max(LOOP_MAX_MS),
    endMs: z.number().int().min(1).max(LOOP_MAX_MS),
  })
  .refine((region) => region.endMs > region.startMs, {
    message: 'The loop must end after it starts.',
    path: ['endMs'],
  });
export type LoopRegion = z.infer<typeof loopRegionSchema>;
