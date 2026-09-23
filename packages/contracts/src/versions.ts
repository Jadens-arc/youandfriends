import { z } from 'zod';

import { ulidSchema, uploadSessionIdSchema } from './ids';

/**
 * The version stack's trust boundary (task `056`).
 *
 * A version is created from a finished upload session and nothing else — there is no field here
 * through which a client could name a storage object, a key, or a version number. The server
 * reads all three from rows it wrote itself.
 */

/** A note on a version: what changed in this bounce. Plain text, rendered escaped. */
export const VERSION_NOTE_MAX = 500;

const noteSchema = z
  .string()
  .trim()
  .max(VERSION_NOTE_MAX, `Keep the note under ${VERSION_NOTE_MAX} characters.`);

export const recordVersionSchema = z.object({
  sessionId: uploadSessionIdSchema,
  note: noteSchema.optional(),
});
export type RecordVersionRequest = z.infer<typeof recordVersionSchema>;

export const setCurrentVersionSchema = z.object({ versionId: ulidSchema });
export type SetCurrentVersionRequest = z.infer<typeof setCurrentVersionSchema>;

/** An empty note clears it. */
export const versionNoteSchema = z.object({ note: noteSchema });
export type VersionNoteRequest = z.infer<typeof versionNoteSchema>;
