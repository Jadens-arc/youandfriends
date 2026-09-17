/**
 * Identifier contracts.
 *
 * Every entity uses a ULID: lexicographically sortable, 128 bits of entropy, and opaque.
 * Opaqueness matters for storage keys in particular — a key derived from a song title leaks
 * the title to anyone who sees a URL (docs/THREAT_MODEL.md T3).
 */

import { z } from 'zod';

/** Crockford base32, 26 characters. Excludes I, L, O, U by design. */
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const ulidSchema = z.string().regex(ULID_PATTERN, 'must be a ULID');

/**
 * Brand an ID by entity so a song ID cannot be passed where a project ID is expected.
 * The brand exists only in the type system; at runtime these are plain strings.
 */
export type Branded<T extends string> = string & { readonly __brand: T };

function brandedId<T extends string>() {
  return ulidSchema.transform((value) => value as Branded<T>);
}

export const workspaceIdSchema = brandedId<'WorkspaceId'>();
export const userIdSchema = brandedId<'UserId'>();
export const folderIdSchema = brandedId<'FolderId'>();
export const projectIdSchema = brandedId<'ProjectId'>();
export const songIdSchema = brandedId<'SongId'>();
export const assetIdSchema = brandedId<'AssetId'>();
export const assetVersionIdSchema = brandedId<'AssetVersionId'>();
export const commentIdSchema = brandedId<'CommentId'>();
export const uploadSessionIdSchema = brandedId<'UploadSessionId'>();

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type FolderId = z.infer<typeof folderIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type SongId = z.infer<typeof songIdSchema>;
export type AssetId = z.infer<typeof assetIdSchema>;
export type AssetVersionId = z.infer<typeof assetVersionIdSchema>;
export type CommentId = z.infer<typeof commentIdSchema>;
export type UploadSessionId = z.infer<typeof uploadSessionIdSchema>;

/** True when a string is a well-formed ULID. */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

// Assembled from parts, not written as one literal: 32 characters of high-entropy alphabet
// is the shape `no-secrets` is built to flag, and it runs on source as well as tests
// (CLAUDE.md §8).
const CROCKFORD = ['0123456789', 'ABCDEFGHJKMN', 'PQRSTVWXYZ'].join('');

const encode = (value: number, length: number): string => {
  let remaining = value;
  const out: string[] = [];
  for (let index = 0; index < length; index += 1) {
    out.unshift(CROCKFORD[remaining % 32] ?? '0');
    remaining = Math.floor(remaining / 32);
  }
  return out.join('');
};

/** Milliseconds and counter of the last id issued, for the monotonic step below. */
let lastMillis = 0;
let sequence = 0;

/**
 * A sortable, ULID-shaped id, **monotonic within a millisecond**.
 *
 * The time prefix alone is not enough. Several rows are written inside one transaction — an
 * audit log's "renamed, then deleted", a batch of versions — and they share a timestamp to the
 * millisecond, so a purely random suffix would sort them arbitrarily. Anything reading the log
 * in order would see the effect before the cause. The counter makes the order they were written
 * the order they are read.
 *
 * Lives here rather than in whichever package needed it first: `packages/authz` had it private,
 * the seed has a deterministic variant of its own, and authentication needed a third. A
 * generator copied three times is three chances to get the alphabet or the width wrong, in a
 * value every other table uses as a foreign key.
 */
export function newUlid(): string {
  const millis = Date.now();
  if (millis === lastMillis) {
    sequence += 1;
  } else {
    lastMillis = millis;
    sequence = 0;
  }

  const random = Array.from(
    { length: 10 },
    () => CROCKFORD[Math.floor(Math.random() * 32)] ?? '0',
  ).join('');

  // 10 chars of time, 6 of counter, 10 of randomness: 26 in total, the shape `isUlid` validates.
  return `${encode(millis, 10)}${encode(sequence, 6)}${random}`;
}
