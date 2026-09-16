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
