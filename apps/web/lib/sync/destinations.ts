import { permissionGrants, projects } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Where the device asking may upload, right now (task `110`): its granted projects, live, that
 * the authorizer still says it may edit — so a project its pairer lost access to drops out here
 * exactly as it would at upload.
 */
export async function agentDestinations(
  context: LibraryContext,
): Promise<readonly { readonly projectId: string; readonly name: string }[]> {
  if (context.subject.kind !== 'sync_token') return [];
  const granted = await context.db
    .select({ projectId: projects.id, name: projects.name })
    .from(permissionGrants)
    .innerJoin(
      projects,
      and(
        eq(projects.id, permissionGrants.scopeId),
        eq(projects.workspaceId, permissionGrants.workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .where(
      and(
        eq(permissionGrants.workspaceId, context.workspaceId),
        eq(permissionGrants.subjectKind, 'sync_token'),
        eq(permissionGrants.subjectId, context.subject.tokenId),
        eq(permissionGrants.scopeType, 'project'),
      ),
    );
  const allowed = await Promise.all(
    granted.map((destination) =>
      context.authz.can(context.subject, 'edit', {
        workspaceId: context.workspaceId,
        scopeType: 'project',
        scopeId: destination.projectId,
      }),
    ),
  );
  return granted.filter((_, index) => allowed[index]);
}
