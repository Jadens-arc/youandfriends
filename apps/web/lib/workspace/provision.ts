import { memberSubject, withAuditedTransaction } from '@youandfriends/authz';
import { newUlid, type UserId, type WorkspaceId } from '@youandfriends/contracts';
import {
  provisionWorkspace,
  type DirectDatabase,
  type ProvisionedWorkspace,
} from '@youandfriends/db';

/**
 * Creating someone's workspace on their first sign-in.
 *
 * The rules live in `provisionWorkspace` (`packages/db`): only for someone with no membership
 * anywhere, and at most once per person, enforced by a unique key rather than by hoping two
 * requests do not arrive together. This file adds the audit event, written in the same
 * transaction, so a workspace never exists without the record of its creation and a rolled-back
 * creation leaves no record claiming it happened (ADR 0006).
 */

export interface ProvisionRequest {
  readonly userId: string;
  readonly displayName: string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly correlationId?: string | undefined;
}

/**
 * The name a new workspace starts with. The owner can change it in settings.
 *
 * Built from Clerk's display name, which is never the email (see `identityFrom`), so the
 * default cannot put an address in front of everyone the workspace is later shared with.
 */
export function defaultWorkspaceName(displayName: string): string {
  return `${displayName}’s workspace`;
}

export async function ensureWorkspace(
  db: DirectDatabase,
  request: ProvisionRequest,
): Promise<ProvisionedWorkspace | null> {
  const newId = request.newId ?? newUlid;
  // Minted before the transaction because the audit context needs it up front. It is used only
  // if this call creates the workspace, and only then is an event written under it.
  const candidateId = newId();

  return withAuditedTransaction(
    db,
    {
      workspaceId: candidateId as WorkspaceId,
      actor: memberSubject(request.userId as UserId),
      correlationId: request.correlationId,
      newId,
      ...(request.now === undefined ? {} : { now: request.now }),
    },
    async ({ tx, audit }) => {
      const outcome = await provisionWorkspace(tx, {
        userId: request.userId,
        name: defaultWorkspaceName(request.displayName),
        workspaceId: candidateId,
        membershipId: newId(),
      });

      if (outcome?.created === true) {
        await audit({
          action: 'workspace.created',
          targetType: 'workspace',
          targetId: outcome.workspaceId,
          metadata: { reason: 'first_sign_in' },
        });
      }

      return outcome;
    },
  );
}
