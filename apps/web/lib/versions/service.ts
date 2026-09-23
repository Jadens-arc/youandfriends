import { permits, withAuditedTransaction, type AuditContext } from '@youandfriends/authz';
import {
  forbidden,
  isUlid,
  newUlid,
  recordVersionSchema,
  versionNoteSchema,
  type RecordVersionRequest,
} from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  mixVersions,
  songs,
  storageObjects,
  uploadSessions,
} from '@youandfriends/db';
import type { StorageDriver } from '@youandfriends/storage';
import { and, eq, isNull, max, sql } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * The mix version stack (task `056`): turning a finished upload into an immutable version,
 * choosing which version is current, per-version notes, and downloading an untouched original.
 *
 * **Append-only.** Nothing here updates or deletes a version's bytes or identity — the schema's
 * `asset_versions_immutable` trigger would refuse it anyway (task `026`), and this module does not
 * try. Making an older version current is a pointer update on `songs`; nothing is copied and
 * nothing is removed.
 *
 * Every entry point authorizes first and answers a refusal 404-shaped (`docs/THREAT_MODEL.md` T1).
 * A song id, a version id, and an upload session id from a request are all untrusted; each is
 * looked up with the workspace filter *and* checked against the song it claims to belong to.
 */

export interface VersionContext extends LibraryContext {
  /**
   * Called after a new asset version is committed — task `064` enqueues its media job here.
   * Outside the transaction on purpose: a job queue is not rolled back with Postgres, so a job
   * enqueued inside a transaction that then failed would process a version that does not exist.
   */
  readonly onVersionRecorded?: ((assetVersionId: string) => Promise<void>) | undefined;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

function auditContextOf(context: LibraryContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: context.now ?? (() => new Date()),
    newId: context.newId ?? newUlid,
  };
}

function songTarget(context: LibraryContext, songId: string) {
  return { workspaceId: context.workspaceId, scopeType: 'song', scopeId: songId } as const;
}

async function assertMayEditSong(context: LibraryContext, songId: string) {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', songTarget(context, songId));
  const [song] = await context.db
    .select({ id: songs.id, title: songs.title })
    .from(songs)
    .where(
      and(
        eq(songs.id, songId),
        eq(songs.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (song === undefined) refuse(`song ${songId} is not live`);
  return song;
}

/**
 * The asset a song's mixes are uploaded into — one per song, whose asset versions *are* the
 * version stack — created the first time someone uploads a mix.
 *
 * Returned so the browser can open an upload session against it (`POST /api/uploads` takes an
 * asset id). Editors only: this is the first step of an upload.
 */
export async function prepareMixUpload(
  context: LibraryContext,
  songId: string,
): Promise<{ assetId: string }> {
  const song = await assertMayEditSong(context, songId);

  const existing = await findMixAsset(context, songId);
  if (existing !== null) return { assetId: existing };

  const assetId = (context.newId ?? newUlid)();
  // Two editors racing to upload a first mix both land here; the second insert is harmless
  // because the read below settles on whichever asset is oldest. A unique index would forbid a
  // second mix asset outright, and nothing in the product needs that to be impossible.
  await context.db.insert(assets).values({
    id: assetId,
    workspaceId: context.workspaceId,
    songId,
    kind: 'mix',
    name: song.title,
  });
  return { assetId: (await findMixAsset(context, songId)) ?? assetId };
}

async function findMixAsset(context: LibraryContext, songId: string): Promise<string | null> {
  const [row] = await context.db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, context.workspaceId),
        eq(assets.songId, songId),
        eq(assets.kind, 'mix'),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(assets.createdAt, assets.id)
    .limit(1);
  return row?.id ?? null;
}

export interface RecordedVersion {
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly versionNumber: number;
  /** False when this call replayed one that had already recorded the upload. */
  readonly created: boolean;
}

/**
 * Record a finished upload session as a new version of its asset — any asset: a mix, a stem, a
 * Project Files entry, artwork.
 *
 * **Idempotent.** Under a row lock on the asset, an existing version already backed by this
 * session's storage object is returned rather than a second one minted — so a replay returns the
 * version the first call made. (Not a unique index: two versions may legitimately share one
 * object, which task `028`'s purge accounts for.) The same lock allocates version numbers, so
 * two uploads finishing together get 3 and 4 rather than colliding on 3.
 */
export async function recordUploadedVersion(
  context: VersionContext,
  sessionId: string,
): Promise<RecordedVersion> {
  if (!isUlid(sessionId)) refuse('session id is not a ULID');

  const [session] = await context.db
    .select({
      assetId: uploadSessions.assetId,
      ownerUserId: uploadSessions.ownerUserId,
      state: uploadSessions.state,
      storageObjectId: uploadSessions.storageObjectId,
      filename: uploadSessions.filename,
    })
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, context.workspaceId)),
    );
  // Someone else's session, an unfinished one, and a missing one are the same answer.
  if (
    session === undefined ||
    session.ownerUserId !== context.userId ||
    session.state !== 'completed' ||
    session.storageObjectId === null
  ) {
    refuse(`no completed upload session ${sessionId} for this person`);
  }
  const storageObjectId = session.storageObjectId;

  const [asset] = await context.db
    .select({ id: assets.id, songId: assets.songId, projectId: assets.projectId })
    .from(assets)
    .where(
      and(
        eq(assets.id, session.assetId),
        eq(assets.workspaceId, context.workspaceId),
        isNull(assets.deletedAt),
      ),
    );
  if (asset === undefined) refuse(`asset ${session.assetId} is not live`);

  // Re-checked here, not trusted from the session's creation: access can be revoked mid-upload.
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: asset.songId === null ? 'project' : 'song',
    scopeId: (asset.songId ?? asset.projectId) as string,
  });

  const result = await withAuditedTransaction(
    context.db,
    auditContextOf(context),
    async ({ tx, audit }) => {
      // Serializes version numbering per asset.
      await tx.execute(sql`select id from assets where id = ${asset.id} for update`);

      const [existing] = await tx
        .select({ id: assetVersions.id, versionNumber: assetVersions.versionNumber })
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.workspaceId, context.workspaceId),
            eq(assetVersions.storageObjectId, storageObjectId),
          ),
        );
      if (existing !== undefined) {
        return {
          assetId: asset.id,
          assetVersionId: existing.id,
          versionNumber: existing.versionNumber,
          created: false,
        };
      }

      const [{ highest } = { highest: null }] = await tx
        .select({ highest: max(assetVersions.versionNumber) })
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.workspaceId, context.workspaceId),
            eq(assetVersions.assetId, asset.id),
          ),
        );
      const versionNumber = (highest ?? 0) + 1;
      const assetVersionId = (context.newId ?? newUlid)();

      await tx.insert(assetVersions).values({
        id: assetVersionId,
        workspaceId: context.workspaceId,
        assetId: asset.id,
        versionNumber,
        storageObjectId,
        uploadedBy: context.userId,
        originalFilename: session.filename,
      });
      await tx
        .update(assets)
        .set({ updatedAt: sql`now()` })
        .where(eq(assets.id, asset.id));

      await audit({
        action: 'version.created',
        targetType: 'asset',
        targetId: asset.id,
        metadata: { assetVersionId, versionNumber, sessionId },
      });

      return { assetId: asset.id, assetVersionId, versionNumber, created: true };
    },
  );

  if (result.created) await context.onVersionRecorded?.(result.assetVersionId);
  return result;
}

export interface RecordedMixVersion extends RecordedVersion {
  readonly mixVersionId: string;
  readonly mixVersionNumber: number;
}

/**
 * Record an upload as the song's newest mix, which becomes current automatically — the
 * `mix_versions_become_current` trigger moves the pointer forward, for every writer.
 */
export async function recordMixVersion(
  context: VersionContext,
  songId: string,
  input: RecordVersionRequest,
): Promise<RecordedMixVersion> {
  const request = recordVersionSchema.parse(input);
  await assertMayEditSong(context, songId);

  // The session must be an upload *into this song's mix asset*. Recording a stem upload, or a
  // mix for a different song, as this song's version would put the wrong bytes in the stack.
  const [session] = await context.db
    .select({ assetId: uploadSessions.assetId, kind: assets.kind, songId: assets.songId })
    .from(uploadSessions)
    .innerJoin(
      assets,
      and(
        eq(assets.id, uploadSessions.assetId),
        eq(assets.workspaceId, uploadSessions.workspaceId),
      ),
    )
    .where(
      and(
        eq(uploadSessions.id, request.sessionId),
        eq(uploadSessions.workspaceId, context.workspaceId),
      ),
    );
  if (session === undefined || session.kind !== 'mix' || session.songId !== songId) {
    refuse(`session ${request.sessionId} is not a mix upload for song ${songId}`);
  }

  const version = await recordUploadedVersion(context, request.sessionId);

  return withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.execute(sql`select id from songs where id = ${songId} for update`);

    const [existing] = await tx
      .select({ id: mixVersions.id, versionNumber: mixVersions.versionNumber })
      .from(mixVersions)
      .where(
        and(
          eq(mixVersions.workspaceId, context.workspaceId),
          eq(mixVersions.assetVersionId, version.assetVersionId),
        ),
      );
    if (existing !== undefined) {
      return {
        ...version,
        mixVersionId: existing.id,
        mixVersionNumber: existing.versionNumber,
        created: false,
      };
    }

    const [{ highest } = { highest: null }] = await tx
      .select({ highest: max(mixVersions.versionNumber) })
      .from(mixVersions)
      .where(and(eq(mixVersions.workspaceId, context.workspaceId), eq(mixVersions.songId, songId)));
    const mixVersionNumber = (highest ?? 0) + 1;
    const mixVersionId = (context.newId ?? newUlid)();

    await tx.insert(mixVersions).values({
      id: mixVersionId,
      workspaceId: context.workspaceId,
      songId,
      versionNumber: mixVersionNumber,
      assetVersionId: version.assetVersionId,
      uploadedBy: context.userId,
      note: request.note === undefined || request.note === '' ? null : request.note,
    });

    await audit({
      action: 'song.updated',
      targetType: 'song',
      targetId: songId,
      metadata: { change: 'version_added', mixVersionId, mixVersionNumber },
    });

    return { ...version, mixVersionId, mixVersionNumber, created: true };
  });
}

/** A version id from a request, confirmed to belong to this song in this workspace. */
async function loadMixVersion(context: LibraryContext, songId: string, versionId: string) {
  if (!isUlid(versionId)) refuse('version id is not a ULID');
  const [row] = await context.db
    .select({
      id: mixVersions.id,
      versionNumber: mixVersions.versionNumber,
      uploadedBy: mixVersions.uploadedBy,
      note: mixVersions.note,
      key: storageObjects.key,
      fileName: sql<string>`coalesce(${assetVersions.originalFilename}, ${assets.name})`,
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
      assets,
      and(eq(assets.id, assetVersions.assetId), eq(assets.workspaceId, assetVersions.workspaceId)),
    )
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, assetVersions.storageObjectId),
        eq(storageObjects.workspaceId, assetVersions.workspaceId),
      ),
    )
    .where(
      and(
        eq(mixVersions.id, versionId),
        eq(mixVersions.songId, songId),
        eq(mixVersions.workspaceId, context.workspaceId),
      ),
    );
  if (row === undefined) refuse(`version ${versionId} is not a version of song ${songId}`);
  return row;
}

/** Make an earlier (or later) version current. A pointer update: nothing is copied or removed. */
export async function setCurrentVersion(
  context: LibraryContext,
  songId: string,
  versionId: string,
): Promise<void> {
  await assertMayEditSong(context, songId);
  const version = await loadMixVersion(context, songId, versionId);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(songs)
      .set({ currentVersionId: version.id })
      .where(and(eq(songs.id, songId), eq(songs.workspaceId, context.workspaceId)));
    await audit({
      action: 'song.updated',
      targetType: 'song',
      targetId: songId,
      metadata: { change: 'current_version', mixVersionId: version.id },
    });
  });
}

/**
 * Whether this viewer may edit a version's note: anyone who may edit the song, or the person who
 * uploaded it while they can still take part in the song at all. The role question is `authz`'s;
 * "is this their upload" is a fact about the row.
 */
export function mayEditVersionNote(
  access: Parameters<typeof permits>[0],
  uploadedBy: string | null,
  userId: string,
): boolean {
  return permits(access, 'edit') || (uploadedBy === userId && permits(access, 'comment'));
}

export async function updateVersionNote(
  context: LibraryContext,
  songId: string,
  versionId: string,
  input: { note: string },
): Promise<void> {
  const { note } = versionNoteSchema.parse(input);
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, songTarget(context, songId));
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);
  const version = await loadMixVersion(context, songId, versionId);
  if (!mayEditVersionNote(access, version.uploadedBy, context.userId)) {
    refuse(`may not edit the note on version ${versionId}`);
  }

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(mixVersions)
      .set({ note: note === '' ? null : note })
      .where(and(eq(mixVersions.id, version.id), eq(mixVersions.workspaceId, context.workspaceId)));
    await audit({
      action: 'song.updated',
      targetType: 'song',
      targetId: songId,
      metadata: { change: 'version_note', mixVersionId: version.id },
    });
  });
}

/**
 * A short-lived URL for the untouched original of one version (`docs/DESIGN.md` §5), gated on
 * the independent `can_download` capability rather than on role.
 *
 * The URL is a bearer credential: it goes into a redirect and nowhere else — not the audit row,
 * not a log line (`docs/THREAT_MODEL.md` T3).
 */
export async function versionDownloadUrl(
  context: LibraryContext & { readonly driver: StorageDriver },
  songId: string,
  versionId: string,
): Promise<string> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  await context.authz.assertCan(context.subject, 'download', songTarget(context, songId));
  const version = await loadMixVersion(context, songId, versionId);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ audit }) => {
    await audit({
      action: 'version.downloaded',
      targetType: 'version',
      targetId: version.id,
      metadata: { songId, versionNumber: version.versionNumber },
    });
  });

  const signed = await context.driver.signDownload({
    key: version.key,
    filename: version.fileName,
  });
  return signed.url;
}
