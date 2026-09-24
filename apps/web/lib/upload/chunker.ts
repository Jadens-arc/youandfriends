import { MAX_PARTS, MIN_PART_SIZE_BYTES } from '@youandfriends/contracts';

/**
 * Splitting a file into multipart-upload parts (task `053`).
 *
 * The part size is the server's decision (`partSizeFor` in `packages/contracts`, returned when
 * the session is opened) — the client does not pick its own, so the part count it plans is the
 * part count the server expects. What the client does check is that the plan it was handed is
 * one S3 will accept, because a bad plan fails only at the very end, after every byte was sent.
 */

export interface PartPlan {
  readonly partNumber: number;
  /** Byte offset, inclusive. */
  readonly start: number;
  /** Byte offset, exclusive. */
  readonly end: number;
}

export class InvalidPartPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPartPlanError';
  }
}

export function planParts(sizeBytes: number, partSizeBytes: number): PartPlan[] {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new InvalidPartPlanError(`cannot upload ${sizeBytes} bytes`);
  }
  // Every part but the last must be at least the floor; a single-part upload may be smaller.
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes < MIN_PART_SIZE_BYTES) {
    throw new InvalidPartPlanError(`part size ${partSizeBytes} is below the 5 MiB floor`);
  }
  const count = Math.ceil(sizeBytes / partSizeBytes);
  if (count > MAX_PARTS) {
    throw new InvalidPartPlanError(`${count} parts exceeds the ${MAX_PARTS}-part ceiling`);
  }

  const parts: PartPlan[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * partSizeBytes;
    parts.push({ partNumber: index + 1, start, end: Math.min(start + partSizeBytes, sizeBytes) });
  }
  return parts;
}
