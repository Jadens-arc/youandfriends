import { describe, expect, it } from 'vitest';

import {
  completeUploadSchema,
  createUploadSchema,
  MAX_PARTS,
  MAX_UPLOAD_BYTES,
  MIN_PART_SIZE_BYTES,
  partCountFor,
  partSizeFor,
  signPartsSchema,
} from './uploads';

const valid = {
  assetId: '01J8XKQ2M3N4P5R6S7T8V9W0XY',
  sizeBytes: 100 * 1024 * 1024,
  contentTypeHint: 'audio/wav',
  filename: 'Blue Hour.wav',
};

describe('what a client may say', () => {
  it('accepts a well-formed request', () => {
    expect(createUploadSchema.safeParse(valid).success).toBe(true);
  });

  it('has no way to name a destination', () => {
    // The property the whole protocol rests on. A client naming a key or a bucket is not a
    // request this schema can express, so there is no check to forget (THREAT_MODEL T4).
    const shape = Object.keys(createUploadSchema.shape);
    for (const forbidden of ['key', 'objectKey', 'bucket', 'path', 'storageObjectId']) {
      expect(shape, forbidden).not.toContain(forbidden);
    }

    // And an extra field is dropped rather than carried through to somewhere that reads it.
    const parsed = createUploadSchema.parse({ ...valid, objectKey: 'w/other/o/theirs' });
    expect(parsed).not.toHaveProperty('objectKey');
  });

  it('refuses an upload above the ceiling', () => {
    expect(
      createUploadSchema.safeParse({ ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success,
    ).toBe(false);
    expect(createUploadSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(createUploadSchema.safeParse({ ...valid, sizeBytes: -1 }).success).toBe(false);
  });

  it('refuses a checksum that is not a SHA-256', () => {
    // A malformed one would silently never match at finalize, turning an integrity check into
    // an unexplained failure.
    for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), '0'.repeat(63)]) {
      expect(
        createUploadSchema.safeParse({ ...valid, expectedChecksumSha256: bad }).success,
        bad,
      ).toBe(false);
    }
    expect(
      createUploadSchema.safeParse({ ...valid, expectedChecksumSha256: 'a'.repeat(64) }).success,
    ).toBe(true);
  });

  it('bounds a signing batch', () => {
    // Unbounded, one request could ask for ten thousand signatures — each a bearer credential.
    expect(signPartsSchema.safeParse({ partNumbers: [1, 2, 3] }).success).toBe(true);
    expect(signPartsSchema.safeParse({ partNumbers: [] }).success).toBe(false);
    expect(
      signPartsSchema.safeParse({ partNumbers: Array.from({ length: 101 }, (_, i) => i + 1) })
        .success,
    ).toBe(false);
    expect(signPartsSchema.safeParse({ partNumbers: [MAX_PARTS + 1] }).success).toBe(false);
    expect(signPartsSchema.safeParse({ partNumbers: [0] }).success).toBe(false);
  });

  it('refuses a completion claiming more parts than S3 allows', () => {
    const part = { partNumber: 1, etag: 'x', sizeBytes: 1 };
    expect(completeUploadSchema.safeParse({ parts: [part] }).success).toBe(true);
    expect(completeUploadSchema.safeParse({ parts: [] }).success).toBe(false);
    expect(
      completeUploadSchema.safeParse({ parts: [{ ...part, partNumber: MAX_PARTS + 1 }] }).success,
    ).toBe(false);
  });
});

describe('choosing a part size', () => {
  it('never goes below what S3 accepts', () => {
    // Below 5 MiB the store refuses the completed upload — discovered at the end of a 2 GB
    // transfer, which is the worst possible moment to find out.
    for (const size of [1, 1024, MIN_PART_SIZE_BYTES - 1, MIN_PART_SIZE_BYTES]) {
      expect(partSizeFor(size), String(size)).toBeGreaterThanOrEqual(MIN_PART_SIZE_BYTES);
    }
  });

  it('keeps the part count under the ceiling, with room to spare', () => {
    // A count *at* the limit leaves no room for a retry to split a part.
    for (const size of [
      MIN_PART_SIZE_BYTES,
      100 * 1024 * 1024,
      2 * 1024 * 1024 * 1024,
      MAX_UPLOAD_BYTES,
    ]) {
      expect(partCountFor(size), String(size)).toBeLessThanOrEqual(MAX_PARTS);
      expect(partCountFor(size), String(size)).toBeGreaterThanOrEqual(1);
    }
  });

  it('grows the part size rather than the count for a large file', () => {
    // Holding at the 5 MiB floor is legal but makes a 5 GiB master 1,024 requests, each a
    // signed bearer credential and each a chance for a flaky connection to retry. This test
    // found that: the first version only grew the part size above 50 GiB, which is past the
    // ceiling, so it never grew at all.
    const small = partSizeFor(100 * 1024 * 1024);
    const large = partSizeFor(MAX_UPLOAD_BYTES);
    expect(large).toBeGreaterThan(small);
  });

  it('keeps a large upload to a few hundred parts, not a few thousand', () => {
    expect(partCountFor(MAX_UPLOAD_BYTES)).toBeLessThan(1000);
    expect(partCountFor(2 * 1024 * 1024 * 1024)).toBeLessThan(1000);
  });

  it('still uses the floor for a small upload', () => {
    // Growing the part size must not make a 10 MiB file a single part with no resumability.
    expect(partSizeFor(10 * 1024 * 1024)).toBe(MIN_PART_SIZE_BYTES);
    expect(partCountFor(10 * 1024 * 1024)).toBe(2);
  });

  it('returns whole mebibytes, so the numbers are legible in a log', () => {
    for (const size of [MAX_UPLOAD_BYTES, 3_000_000_000, 700 * 1024 * 1024]) {
      expect(partSizeFor(size) % (1024 * 1024), String(size)).toBe(0);
    }
  });

  it('covers the whole file', () => {
    // The check that would catch an off-by-one in the division: parts × size must reach the end.
    for (const size of [1, MIN_PART_SIZE_BYTES + 1, 2 * 1024 * 1024 * 1024, MAX_UPLOAD_BYTES]) {
      expect(partCountFor(size) * partSizeFor(size), String(size)).toBeGreaterThanOrEqual(size);
    }
  });
});
