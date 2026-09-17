/**
 * `@youandfriends/storage`
 *
 * The object storage boundary: opaque keys, presigned URLs with short lives, and multipart
 * uploads.
 *
 * **It authorizes nothing.** Every method assumes the caller has already asked
 * `@youandfriends/authz` and been told yes. A route handler must not reach this package
 * directly (`docs/ARCHITECTURE.md` §3) — it goes through the upload and download services that
 * own the check, because a driver that also decided who may read would put two answers to that
 * question in the codebase.
 *
 * **Nothing here has been run against a real bucket.** Task `052` stands up MinIO and runs the
 * contract tests; until then this compiles, its logic is tested, and no byte has moved.
 */

export const PACKAGE_NAME = '@youandfriends/storage' as const;

export {
  DEFAULT_TTLS,
  type MultipartUpload,
  type ObjectHead,
  type PresignedUrl,
  type PresignTtls,
  type SignDownloadInput,
  type SignPartInput,
  type StorageDriver,
  type UploadedPart,
} from './driver';

export {
  classPrefix,
  newObjectKey,
  OBJECT_CLASSES,
  parseObjectKey,
  workspacePrefix,
  type ObjectClass,
} from './keys';

export {
  assertBucketPrivate,
  contentDisposition,
  createR2Driver,
  r2ConfigFrom,
  StorageNotConfiguredError,
  type R2Config,
} from './r2';
