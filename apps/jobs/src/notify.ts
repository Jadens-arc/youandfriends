import { newUlid } from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  mixVersions,
  recordNotifications,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import type { MediaNotificationSink } from './pipeline';

/**
 * The media worker's notifications (task `095`): the person who uploaded a version hears that it
 * is ready to play, or that it could not be processed. Nobody else — a finished transcode is not
 * news to the rest of the song's collaborators, who heard about the upload when it was made.
 *
 * Addressed to the uploader alone, so no audience is computed here; the notification center
 * still filters by access when it is read. A voice note's processing is not announced: its
 * comment already was. Failures to notify are logged and never fail the job.
 */
export function createMediaNotifier(
  db: DirectDatabase,
  options: { readonly now?: () => Date; readonly newId?: () => string } = {},
): MediaNotificationSink {
  return async (event) => {
    try {
      const [row] = await db
        .select({
          uploadedBy: assetVersions.uploadedBy,
          versionNumber: assetVersions.versionNumber,
          filename: assetVersions.originalFilename,
          kind: assets.kind,
          songId: assets.songId,
          projectId: assets.projectId,
          mixVersionId: mixVersions.id,
          mixNumber: mixVersions.versionNumber,
        })
        .from(assetVersions)
        .innerJoin(
          assets,
          and(
            eq(assets.id, assetVersions.assetId),
            eq(assets.workspaceId, assetVersions.workspaceId),
          ),
        )
        .leftJoin(
          mixVersions,
          and(
            eq(mixVersions.assetVersionId, assetVersions.id),
            eq(mixVersions.workspaceId, assetVersions.workspaceId),
          ),
        )
        .where(
          and(
            eq(assetVersions.id, event.assetVersionId),
            eq(assetVersions.workspaceId, event.workspaceId),
          ),
        );
      if (row === undefined || row.uploadedBy === null || row.kind === 'voice_note') return;
      const targetType = row.songId === null ? 'project' : 'song';
      const targetId = row.songId ?? row.projectId;
      if (targetId === null) return;
      await recordNotifications(db, {
        workspaceId: event.workspaceId,
        recipientIds: [row.uploadedBy],
        event: event.event,
        targetType,
        targetId,
        actorId: null,
        preview:
          row.mixNumber === null
            ? `${row.filename ?? 'File'} — version ${row.versionNumber}`
            : `Version ${row.mixNumber}`,
        link: row.mixVersionId === null ? { tab: 'files' } : { versionId: row.mixVersionId },
        at: (options.now ?? (() => new Date()))(),
        newId: options.newId ?? newUlid,
      });
    } catch (error) {
      console.error('media notification failed', {
        assetVersionId: event.assetVersionId,
        name: error instanceof Error ? error.name : typeof error,
      });
    }
  };
}
