import { permits } from '@youandfriends/authz';
import { conflict, forbidden, isUlid, newUlid } from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  comments,
  derivatives,
  songs,
  storageObjects,
  type DirectDatabase,
} from '@youandfriends/db';
import type { StorageDriver } from '@youandfriends/storage';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Voice notes (task `093`): a recording made in the browser, stored and processed exactly like
 * music — a private original, the same upload path, the same media pipeline — and attached to a
 * comment.
 *
 * Recording is a *comment* action, not an edit: a commenter may create a `voice_note` asset on a
 * song they can comment on, and only they may upload its one recording (the upload service
 * enforces both). Listening is `view` on the song, and only while a live comment carries it.
 */

type Tx = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

/** The largest recording accepted. Minutes of Opus or AAC voice are a few megabytes. */
export const VOICE_NOTE_MAX_BYTES = 25 * 1024 * 1024;

function refuse(detail: string): never {
  throw forbidden({ detail });
}

async function liveSong(context: LibraryContext, songId: string) {
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
}

/** Make the asset a recording will be uploaded into. Commenters and above. */
export async function createVoiceNoteAsset(
  context: LibraryContext,
  songId: string,
): Promise<{ readonly assetId: string }> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  await context.authz.assertCan(context.subject, 'comment', {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  await liveSong(context, songId);
  const assetId = (context.newId ?? newUlid)();
  await context.db.insert(assets).values({
    id: assetId,
    workspaceId: context.workspaceId,
    songId,
    projectId: null,
    kind: 'voice_note',
    name: 'Voice note',
    createdBy: context.userId,
  });
  return { assetId };
}

/**
 * Confirm a voice note may be attached to a new comment by this person on this song: theirs,
 * on this song, live, recorded (its upload finished), and not already on another comment.
 */
export async function assertAttachableVoiceNote(
  tx: Tx,
  context: LibraryContext,
  songId: string,
  assetId: string,
): Promise<void> {
  if (!isUlid(assetId)) refuse('voice note id is not a ULID');
  const [asset] = await tx
    .select({ id: assets.id, createdBy: assets.createdBy })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.workspaceId, context.workspaceId),
        eq(assets.songId, songId),
        eq(assets.kind, 'voice_note'),
        isNull(assets.deletedAt),
      ),
    );
  if (asset === undefined || asset.createdBy !== context.userId) {
    refuse(`voice note ${assetId} is not theirs on song ${songId}`);
  }
  const [version] = await tx
    .select({ id: assetVersions.id })
    .from(assetVersions)
    .where(
      and(eq(assetVersions.assetId, assetId), eq(assetVersions.workspaceId, context.workspaceId)),
    )
    .limit(1);
  if (version === undefined) refuse(`voice note ${assetId} has no recording yet`);
  const [used] = await tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(eq(comments.voiceNoteAssetId, assetId), eq(comments.workspaceId, context.workspaceId)),
    )
    .limit(1);
  if (used !== undefined) refuse(`voice note ${assetId} is already on a comment`);
}

/** A comment's voice note as the list shows it. */
export interface VoiceNoteView {
  readonly assetId: string;
  readonly durationMs: number | null;
  readonly state: 'processing' | 'ready' | 'failed';
}

type Derived = 'streaming_audio' | 'waveform_peaks';

/**
 * The derivative of a voice note someone may hear: `view` on the song, the song live, the asset a
 * voice note of that song, carried by a live (not deleted) comment, and processed.
 */
async function authorizedVoiceDerivative(
  context: LibraryContext,
  songId: string,
  assetId: string,
  kind: Derived,
) {
  if (!isUlid(songId) || !isUlid(assetId)) refuse('not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);
  await liveSong(context, songId);
  const [carried] = await context.db
    .select({ id: comments.id })
    .from(comments)
    .innerJoin(
      assets,
      and(eq(assets.id, comments.voiceNoteAssetId), eq(assets.workspaceId, comments.workspaceId)),
    )
    .where(
      and(
        eq(comments.workspaceId, context.workspaceId),
        eq(comments.voiceNoteAssetId, assetId),
        isNull(comments.tombstonedAt),
        eq(assets.songId, songId),
        eq(assets.kind, 'voice_note'),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);
  if (carried === undefined) refuse(`voice note ${assetId} is not on a live comment of ${songId}`);
  const [derived] = await context.db
    .select({
      key: storageObjects.key,
      contentType: storageObjects.contentType,
      sizeBytes: storageObjects.sizeBytes,
    })
    .from(assetVersions)
    .innerJoin(
      derivatives,
      and(
        eq(derivatives.assetVersionId, assetVersions.id),
        eq(derivatives.workspaceId, assetVersions.workspaceId),
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
        eq(assetVersions.assetId, assetId),
        eq(assetVersions.workspaceId, context.workspaceId),
        eq(derivatives.kind, kind),
        eq(derivatives.processingState, 'complete'),
      ),
    )
    .orderBy(desc(assetVersions.versionNumber))
    .limit(1);
  // Still processing, or it failed: "not ready", never the original.
  if (derived === undefined) throw conflict({ detail: `voice note ${assetId} has no ${kind} yet` });
  return derived;
}

type Driven = LibraryContext & { readonly derivativesDriver: () => StorageDriver };

export async function voiceNoteStream(
  context: Driven,
  songId: string,
  assetId: string,
): Promise<{ readonly url: string; readonly expiresAt: string }> {
  const stream = await authorizedVoiceDerivative(context, songId, assetId, 'streaming_audio');
  const signed = await context
    .derivativesDriver()
    .signStream({ key: stream.key, contentType: stream.contentType });
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}

export async function voiceNotePeaks(
  context: Driven,
  songId: string,
  assetId: string,
): Promise<Uint8Array> {
  const peaks = await authorizedVoiceDerivative(context, songId, assetId, 'waveform_peaks');
  const bytes = await context.derivativesDriver().readPrefix(peaks.key, peaks.sizeBytes);
  if (bytes.byteLength !== peaks.sizeBytes) {
    throw conflict({ detail: `waveform for voice note ${assetId} is not readable` });
  }
  return bytes;
}
