import { createAuthorizer, type Authorizer, type Subject } from '@youandfriends/authz';
import { parseServerEnv } from '@youandfriends/config';
import type { WorkspaceId } from '@youandfriends/contracts';
import type { DirectDatabase } from '@youandfriends/db';
import { createR2Driver, r2ConfigFrom, StorageNotConfiguredError } from '@youandfriends/storage';

import { transactionalDatabase } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/workspace/current';

import type { CoverSigner } from './covers';

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
  /** Signs cover rendition reads (task `069`); absent when no derivatives bucket is configured. */
  readonly coverSigner?: CoverSigner | undefined;
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
    coverSigner: coverSigner(),
  };
}

let signer: CoverSigner | null | undefined;

/**
 * Signs a cover read against the derivatives bucket, or `undefined` when that bucket is not
 * configured — cards then show their placeholder rather than failing the page.
 */
function coverSigner(): CoverSigner | undefined {
  if (signer === undefined) {
    try {
      const driver = createR2Driver(r2ConfigFrom(parseServerEnv(), 'derivatives'));
      signer = async (key, contentType) => (await driver.signStream({ key, contentType })).url;
    } catch (error) {
      if (!(error instanceof StorageNotConfiguredError)) throw error;
      signer = null;
    }
  }
  return signer ?? undefined;
}
