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
 * **The S3-compatible path is pinned by contract tests, not assumed.** Task `052` moves generated
 * bytes through a real MinIO server and records the remaining R2 assumptions in ADR 0001. Run
 * `pnpm --filter @youandfriends/storage test:contract`; without MinIO it skips loudly rather than
 * reporting protocol evidence it did not collect.
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
  derivativeObjectKey,
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

export {
  assertOverwritable,
  createR2Transfer,
  limitBytes,
  TransferLimitError,
  type ObjectTransfer,
  type TransferOptions,
} from './transfer';
