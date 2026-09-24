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
