import 'server-only';

import { createAuthorizer } from '@youandfriends/authz';
import { parseServerEnv } from '@youandfriends/config';
import type { ErrorResponse } from '@youandfriends/contracts';
import {
  createR2Driver,
  r2ConfigFrom,
  StorageNotConfiguredError,
  type StorageDriver,
} from '@youandfriends/storage';

import { errorJson } from '@/lib/api/http';
import { transactionalDatabase } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/workspace/current';

import { UploadError, type UploadContext } from './service';

/**
 * Transport for the upload protocol (task `058`): building an `UploadContext` for a request, and
 * mapping the service's refusals onto HTTP.
 *
 * The context's `workspaceId` comes from the resolved session and from nowhere else — not from
 * the body, not from a header, not from the path. That is the one thing this layer could get
 * wrong that the service below it cannot catch.
 */

let originals: StorageDriver | null = null;

/** The originals bucket's driver, memoized per warm instance. Throws when R2 is unconfigured. */
export function originalsDriver(): StorageDriver {
  originals ??= createR2Driver(r2ConfigFrom(parseServerEnv(), 'originals'));
  return originals;
}

export function uploadContextFor(
  context: WorkspaceContext,
  correlationId: string,
  driver: StorageDriver = originalsDriver(),
): UploadContext {
  const db = transactionalDatabase();
  const env = parseServerEnv();
  return {
    db,
    driver,
    // Per request, never shared: the authorizer memoizes, and a reused one would answer a
    // finalize with the decision made at creation (see `assertMayWriteAsset`).
    authz: createAuthorizer(db),
    workspaceId: context.workspace.workspaceId,
    subject: context.subject,
    userId: context.userId,
    correlationId,
    quotaBytes: env.YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES,
    maxObjectBytes: env.YOUANDFRIENDS_MAX_OBJECT_BYTES,
  };
}

/**
 * `UploadError` → status. **`not_found` and `forbidden` are both 404**: an upload session or an
 * asset in another workspace, or one belonging to someone else, is indistinguishable from one
 * that does not exist (`docs/THREAT_MODEL.md` T1). Nothing here returns 403.
 */
export const UPLOAD_ERROR_STATUS: Readonly<Record<UploadError['code'], number>> = {
  not_found: 404,
  forbidden: 404,
  expired: 410,
  size_exceeded: 413,
  part_count_exceeded: 413,
  object_missing: 409,
  checksum_mismatch: 422,
  invalid_state: 409,
  // 413 rather than 507: nothing is wrong with the server, the request is too large for the
  // space this workspace has left.
  quota_exceeded: 413,
};

/** What the client is told for each — a fixed sentence, never the service's own message. */
const UPLOAD_ERROR_MESSAGE: Readonly<Record<UploadError['code'], string>> = {
  not_found: 'Not found.',
  forbidden: 'Not found.',
  expired: 'This upload has expired. Start it again.',
  size_exceeded: 'The upload is larger than was declared.',
  part_count_exceeded: 'The upload has too many parts.',
  object_missing: 'Some parts of the upload never arrived. Retry the missing parts.',
  checksum_mismatch: 'The uploaded file does not match its checksum.',
  invalid_state: 'This upload has already finished or been cancelled.',
  quota_exceeded: 'This workspace does not have room for this file.',
};

const PUBLIC_CODE: Readonly<Record<UploadError['code'], ErrorResponse['code']>> = {
  not_found: 'not_found',
  forbidden: 'not_found',
  expired: 'conflict',
  size_exceeded: 'validation_failed',
  part_count_exceeded: 'validation_failed',
  object_missing: 'conflict',
  checksum_mismatch: 'validation_failed',
  invalid_state: 'conflict',
  quota_exceeded: 'validation_failed',
};

export function mapUploadError(error: unknown, correlationId: string): Response | null {
  if (error instanceof UploadError) {
    return errorJson(UPLOAD_ERROR_STATUS[error.code], {
      code: PUBLIC_CODE[error.code],
      message: UPLOAD_ERROR_MESSAGE[error.code],
      correlationId,
    });
  }
  if (error instanceof StorageNotConfiguredError) {
    // Honest and retryable: nothing is wrong with the request, the deployment has no bucket.
    return errorJson(
      503,
      { code: 'internal', message: 'File storage is not configured.', correlationId },
      { 'retry-after': '300' },
    );
  }
  return null;
}
