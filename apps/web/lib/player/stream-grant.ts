import { conflict, forbidden, isUlid } from '@youandfriends/contracts';
import { assetVersions, derivatives, mixVersions, songs, storageObjects } from '@youandfriends/db';
import type { StorageDriver } from '@youandfriends/storage';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * A stream URL for one mix version (task `070`).
 *
 * Authorized as `view` on the version's song — listening is viewing; *downloading* the original is
 * the separately gated capability (`docs/DESIGN.md` §3). Checked on every call, and the player
 * calls again before each URL expires, so revoking someone's access stops their playback at the
 * next refresh rather than never (`docs/THREAT_MODEL.md` T3).
 *
 * The URL is for the streaming derivative (ADR 0004), never the original, and is a bearer
 * credential: returned to this caller only, never logged, never stored.
 */
export interface StreamGrant {
  readonly url: string;
  readonly expiresAt: string;
  readonly songId: string;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

export async function streamUrlFor(
  context: LibraryContext & { readonly derivativesDriver: () => StorageDriver },
  versionId: string,
): Promise<StreamGrant> {
  if (!isUlid(versionId)) refuse('version id is not a ULID');
  const [version] = await context.db
    .select({ songId: mixVersions.songId, assetVersionId: mixVersions.assetVersionId })
    .from(mixVersions)
    .innerJoin(
      songs,
      and(eq(songs.id, mixVersions.songId), eq(songs.workspaceId, mixVersions.workspaceId)),
    )
    .where(
      and(
        eq(mixVersions.id, versionId),
        eq(mixVersions.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (version === undefined) refuse(`version ${versionId} is not live in this workspace`);
  await context.authz.assertCan(context.subject, 'view', {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: version.songId,
  });

  const [stream] = await context.db
    .select({ key: storageObjects.key, contentType: storageObjects.contentType })
    .from(derivatives)
    .innerJoin(
      assetVersions,
      and(
        eq(assetVersions.id, derivatives.assetVersionId),
        eq(assetVersions.workspaceId, derivatives.workspaceId),
      ),
    )
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, derivatives.storageObjectId),
        eq(storageObjects.workspaceId, derivatives.workspaceId),
      ),
    )
    .where(
      and(
        eq(derivatives.assetVersionId, version.assetVersionId),
        eq(derivatives.workspaceId, context.workspaceId),
        eq(derivatives.kind, 'streaming_audio'),
        eq(derivatives.processingState, 'complete'),
      ),
    )
    .limit(1);
  // Not processed yet, or processing failed. Said as such: the player shows "processing", not an
  // error, and never falls back to streaming a 2 GB original.
  if (stream === undefined) throw conflict({ detail: `version ${versionId} has no stream yet` });

  const signed = await context.derivativesDriver().signStream(stream);
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), songId: version.songId };
}
