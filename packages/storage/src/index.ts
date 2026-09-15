/**
 * `@youandfriends/storage`
 *
 * The StorageDriver interface and its Cloudflare R2 implementation. Presigning and multipart upload.
 *
 * Implementation arrives in task `050`. This package exists from the first commit so the
 * dependency direction described in `docs/ARCHITECTURE.md` §3 is enforced by the
 * workspace graph rather than by convention.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/storage' as const;
