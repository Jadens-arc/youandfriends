import { permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  conflict,
  forbidden,
  isUlid,
  newUlid,
  type ProcessingState,
} from '@youandfriends/contracts';
import {
  assetVersions,
  listVersionProcessingStates,
  mediaJobs,
  mixVersions,
  songs,
} from '@youandfriends/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Processing status for the song page, and the editor's "try again" (task `065`).
 *
 * The status read is what the page polls while a version is still processing, so it is small and
 * authorized like the page itself: anyone who can view the song. Retrying is an edit — it spends
 * worker time and replaces a failure the rest of the collaborators can see — so it is authorized
 * as `edit` and audited.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

export interface ProcessingContext extends LibraryContext {
  /**
   * Hands the version back to the job queue under a fresh idempotency key — the queue remembers
   * the failed run's key and would otherwise return it. Wired to task `064`'s enqueue by
   * `lib/versions/http.ts`.
   */
  readonly requestProcessing?:
    ((assetVersionId: string, idempotencyKey: string) => Promise<void>) | undefined;
}

export async function readProcessingStates(
  context: LibraryContext,
  songId: string,
): Promise<{ readonly id: string; readonly processingState: ProcessingState }[]> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);
  const [song] = await context.db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        eq(songs.id, songId),
        eq(songs.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (song === undefined) refuse(`song ${songId} is not live`);
  return listVersionProcessingStates(context.db, context.workspaceId, songId);
}

/**
 * Send one failed version back for processing. Only a `failed` version: one still queued or
 * processing is already on its way, and a complete one has nothing to fix.
 */
export async function retryProcessing(
  context: ProcessingContext,
  songId: string,
  versionId: string,
): Promise<void> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  if (!isUlid(versionId)) refuse('version id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });

  const [version] = await context.db
    .select({
      assetVersionId: assetVersions.id,
      processingState: assetVersions.processingState,
      versionNumber: mixVersions.versionNumber,
    })
    .from(mixVersions)
    .innerJoin(
      assetVersions,
      and(
        eq(assetVersions.id, mixVersions.assetVersionId),
        eq(assetVersions.workspaceId, mixVersions.workspaceId),
      ),
    )
    .innerJoin(
      songs,
      and(eq(songs.id, mixVersions.songId), eq(songs.workspaceId, mixVersions.workspaceId)),
    )
    .where(
      and(
        eq(mixVersions.id, versionId),
        eq(mixVersions.songId, songId),
        eq(mixVersions.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (version === undefined) refuse(`version ${versionId} is not a version of song ${songId}`);
  if (version.processingState !== 'failed') {
    throw conflict({ detail: `version ${versionId} is ${version.processingState}, not failed` });
  }

  const retried = await withAuditedTransaction(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      now: context.now ?? (() => new Date()),
      newId: context.newId ?? newUlid,
    },
    async ({ tx, audit }) => {
      // Guarded on `failed` again, inside the transaction: two editors pressing retry at once
      // produce one retry and one conflict, not two runs.
      const reset = await tx
        .update(assetVersions)
        .set({ processingState: 'queued', processingError: null })
        .where(
          and(
            eq(assetVersions.id, version.assetVersionId),
            eq(assetVersions.workspaceId, context.workspaceId),
            eq(assetVersions.processingState, 'failed'),
          ),
        )
        .returning({ id: assetVersions.id });
      if (reset.length === 0) return false;
      await tx
        .update(mediaJobs)
        .set({ state: 'queued', lastError: null, finishedAt: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(mediaJobs.assetVersionId, version.assetVersionId),
            eq(mediaJobs.workspaceId, context.workspaceId),
          ),
        );
      await audit({
        action: 'version.processing_retried',
        targetType: 'song',
        targetId: songId,
        metadata: { mixVersionId: versionId, versionNumber: version.versionNumber },
      });
      return true;
    },
  );
  if (!retried) throw conflict({ detail: `version ${versionId} was retried concurrently` });

  // After the commit, like the first enqueue (task `056`'s hook): the queue does not roll back.
  await context.requestProcessing?.(
    version.assetVersionId,
    `retry-${(context.newId ?? newUlid)()}`,
  );
}
