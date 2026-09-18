import { z } from 'zod';

import { assetIdSchema, ulidSchema } from './ids';

/**
 * The upload protocol's trust boundary.
 *
 * **Note what the client is never allowed to say.** There is no object key in any request
 * schema, and no bucket. The key is issued by the server at session creation and read from the
 * session row at every later step, so a client naming a destination is not a request the
 * protocol can express — rather than one a check might one day forget to reject
 * (`docs/THREAT_MODEL.md` T4).
 *
 * What the client may say is what it intends to send, and later what it believes it sent. Both
 * are verified against the store before anything is created.
 */

/** S3's ceiling. A session claiming more parts is broken or hostile; there is no third case. */
export const MAX_PARTS = 10_000;
/** S3's floor for every part but the last. Below it a completed upload is refused. */
export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
/** The largest single upload the product accepts. A 2 GB master is the case this is for. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export const createUploadSchema = z.object({
  assetId: assetIdSchema,
  /**
   * What the client expects to send. Checked against the ceiling now, and against the object
   * that actually arrives at finalize — a client that under-declares does not get a larger
   * ceiling, it gets a refusal.
   */
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  /**
   * A hint, and named one. The stored content type is derived from the bytes at finalize;
   * trusting this would let a client label anything as audio.
   */
  contentTypeHint: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  /** Optional end-to-end check. When given, finalize compares it with the stored object. */
  expectedChecksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex SHA-256')
    .optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadSchema>;

export const signPartsSchema = z.object({
  // A batch, because signing one at a time costs a round trip per part and a 2 GB upload has
  // hundreds. Bounded so one request cannot ask for ten thousand signatures.
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(100),
});
export type SignPartsRequest = z.infer<typeof signPartsSchema>;

export const completeUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_PARTS),
        etag: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(MAX_PARTS),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadSchema>;

export const uploadSessionSchema = z.object({
  id: ulidSchema,
  assetId: assetIdSchema,
  partSizeBytes: z.number().int().min(MIN_PART_SIZE_BYTES),
  partCount: z.number().int().min(1).max(MAX_PARTS),
  expiresAt: z.string().datetime(),
});
export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const signedPartSchema = z.object({
  partNumber: z.number().int().min(1).max(MAX_PARTS),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type SignedPart = z.infer<typeof signedPartSchema>;

/**
 * How many parts to aim for, regardless of size.
 *
 * Not the ceiling — the *target*. Holding the part size at the 5 MiB floor keeps every upload
 * legal, but a 5 GiB master then takes 1,024 parts, which is 1,024 signed URLs, 1,024 requests,
 * and 1,024 chances for a flaky connection to need a retry. Growing the part size instead trades
 * a larger retry unit for far fewer of them, which is the better trade on the large uploads this
 * product exists for.
 *
 * 500 leaves an order of magnitude of headroom under S3's 10,000, so a client that splits a part
 * to retry it cannot walk into the limit.
 */
const TARGET_PARTS = 500;

/**
 * The part size for an upload of a given size.
 *
 * Two floors and a target: never below what S3 accepts, never so small that a large file needs
 * thousands of round trips, and never a count near the ceiling. Rounded up to a whole MiB so the
 * numbers are legible in a log.
 */
export function partSizeFor(sizeBytes: number): number {
  const mib = 1024 * 1024;
  // What it takes to stay under the hard ceiling, and what it takes to hit the target. The
  // larger wins, and the floor beats both for a small file.
  const underCeiling = Math.ceil(sizeBytes / MAX_PARTS);
  const atTarget = Math.ceil(sizeBytes / TARGET_PARTS);
  const wanted = Math.max(MIN_PART_SIZE_BYTES, underCeiling, atTarget);
  return Math.ceil(wanted / mib) * mib;
}

/** How many parts an upload of this size will take, at the size {@link partSizeFor} gives it. */
export function partCountFor(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSizeFor(sizeBytes)));
}
