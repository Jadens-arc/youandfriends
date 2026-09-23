import { createAuthorizer, type Authorizer, type Subject } from '@youandfriends/authz';
import type { WorkspaceId } from '@youandfriends/contracts';
import type { DirectDatabase } from '@youandfriends/db';

import { transactionalDatabase } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/workspace/current';

/**
 * The per-request handle the library folder tree's use cases take (task `040`).
 *
 * Carries its own `authz: Authorizer` rather than reusing one built elsewhere, for the same
 * reason `invitationContext` does (`apps/web/lib/invitations/context.ts`): "create one per
 * request and throw it away" (`packages/authz/src/authorizer.ts`).
 */
export interface LibraryContext {
  readonly db: DirectDatabase;
  readonly authz: Authorizer;
  readonly subject: Subject;
  readonly workspaceId: WorkspaceId;
  readonly userId: string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
}

export function libraryContext(context: WorkspaceContext): LibraryContext {
  const db = transactionalDatabase();
  return {
    db,
    authz: createAuthorizer(db),
    subject: context.subject,
    workspaceId: context.workspace.workspaceId,
    userId: context.userId,
    correlationId: context.correlationId,
  };
}
