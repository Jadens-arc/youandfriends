import 'server-only';

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { loggerForEnv } from '@youandfriends/config';
import type { Subject } from '@youandfriends/authz';

import { currentSession } from '@/lib/auth/current-session';
import { transactionalDatabase } from '@/lib/database';

import { resolveWorkspace, WORKSPACE_COOKIE, type CurrentWorkspace } from './resolve';
import type { WorkspaceRequest } from './settings';

/** A signed-in request, resolved to the workspace it is working in. */
export interface WorkspaceContext {
  readonly subject: Subject;
  readonly userId: string;
  readonly workspace: CurrentWorkspace;
  /** Joins audit rows to the platform's request log. */
  readonly correlationId: string | undefined;
}

/**
 * The workspace for this request, for server components, server actions, and route handlers.
 *
 * `cache()` scopes the memo to one request, so the layout and the page resolve once between
 * them. The first call for a person with no workspace provisions one — which is what makes a
 * workspace exist "from the first moment": the first authenticated render is the first moment.
 *
 * **Fails closed.** `null` means signed out, or signed in but unresolvable (the database
 * unreachable, provisioning refused); either way the caller shows no workspace data. The error
 * is logged, never swallowed.
 */
export const currentWorkspace = cache(async (): Promise<WorkspaceContext | null> => {
  const session = await currentSession();
  if (session === null) return null;

  const requestHeaders = await headers();
  const correlationId = requestHeaders.get('x-vercel-id') ?? undefined;

  try {
    const workspace = await resolveWorkspace(transactionalDatabase(), {
      userId: session.userId,
      displayName: session.displayName,
      requested: (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null,
      correlationId,
    });
    if (workspace === null) return null;
    return { subject: session.subject, userId: session.userId, workspace, correlationId };
  } catch (error) {
    loggerForEnv({ NODE_ENV: process.env.NODE_ENV ?? 'production' }).error(
      'workspace resolution failed',
      { error, correlationId },
    );
    return null;
  }
});

/** The per-request handle the settings use cases take. */
export function workspaceRequest(context: WorkspaceContext): WorkspaceRequest {
  return {
    db: transactionalDatabase(),
    subject: context.subject,
    workspaceId: context.workspace.workspaceId,
    correlationId: context.correlationId,
  };
}
