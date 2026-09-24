import 'server-only';

import { libraryContext } from '@/lib/library/context';
import { originalsDriver } from '@/lib/uploads/http';
import type { WorkspaceContext } from '@/lib/workspace/current';

import type { VersionContext } from './service';

/** The per-request context the version routes hand the service (task `056`). */
export function versionContextFor(
  context: WorkspaceContext,
  correlationId: string,
): VersionContext {
  return { ...libraryContext(context), correlationId };
}

export function downloadContextFor(context: WorkspaceContext, correlationId: string) {
  return { ...versionContextFor(context, correlationId), driver: originalsDriver() };
}
