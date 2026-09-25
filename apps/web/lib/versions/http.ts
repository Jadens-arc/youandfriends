import 'server-only';

import { libraryContext } from '@/lib/library/context';
import { enqueueVersionProcessing } from '@/lib/media/enqueue';
import { originalsDriver } from '@/lib/uploads/http';
import type { WorkspaceContext } from '@/lib/workspace/current';

import type { ProcessingContext } from './processing';
import type { VersionContext } from './service';

/** The per-request context the version routes hand the service (task `056`). */
export function versionContextFor(
  context: WorkspaceContext,
  correlationId: string,
): VersionContext & ProcessingContext {
  const library = libraryContext(context);
  const enqueue = enqueueVersionProcessing(library.workspaceId, correlationId);
  return {
    ...library,
    correlationId,
    onVersionRecorded: (assetVersionId) => enqueue(assetVersionId),
    requestProcessing: enqueue,
  };
}

export function downloadContextFor(context: WorkspaceContext, correlationId: string) {
  return { ...versionContextFor(context, correlationId), driver: originalsDriver() };
}
