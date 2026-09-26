import { createAuthorizer, type Authorizer, type Subject } from '@youandfriends/authz';
import type { WorkspaceId } from '@youandfriends/contracts';
import type { DirectDatabase } from '@youandfriends/db';

import { transactionalDatabase } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/workspace/current';
import { notificationSink } from '@/lib/notifications/generate';
import type { NotificationSink } from '@/lib/notifications/types';

/**
 * The per-request handle invitation use cases take.
 *
 * Carries its own `authz: Authorizer` rather than reusing one built elsewhere — "create one
 * per request and throw it away" (`packages/authz/src/authorizer.ts`). Its cache would
 * otherwise outlive the single decision this handle exists for, and a revoked grant would keep
 * answering the way it used to (`docs/THREAT_MODEL.md` T2).
 */
export interface InvitationContext {
  readonly db: DirectDatabase;
  readonly authz: Authorizer;
  readonly subject: Subject;
  readonly workspaceId: WorkspaceId;
  readonly userId: string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
  /** Domain events (task `095`): someone with an account hears they were invited. */
  readonly notify?: NotificationSink | undefined;
}

export function invitationContext(context: WorkspaceContext): InvitationContext {
  const db = transactionalDatabase();
  return {
    db,
    authz: createAuthorizer(db),
    subject: context.subject,
    workspaceId: context.workspace.workspaceId,
    userId: context.userId,
    correlationId: context.correlationId,
    notify: notificationSink(db, context.workspace.workspaceId),
  };
}
