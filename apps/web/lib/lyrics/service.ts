import { permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  conflict,
  EMPTY_LYRICS,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  lyricsPlainText,
  newUlid,
  saveLyricsSchema,
  validationFailed,
  type LyricsDocument,
  type SaveLyricsRequest,
} from '@youandfriends/contracts';
import { lyricsDocuments, songs } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';
import type { NotificationSink } from '@/lib/library/metadata';

/**
 * Lyrics storage (task `080`, ADR 0003). Postgres is canonical.
 *
 * Every read is `view` on the song and every write is `edit` — checked on **every** save, so an
 * autosave from someone whose access was revoked mid-session is refused rather than written
 * (`docs/THREAT_MODEL.md`, asset 2). A save names the version it started from; any other current
 * version is a conflict, never a silent overwrite.
 */

export interface LyricsView {
  readonly document: LyricsDocument;
  /** 0 when the song has no lyrics yet. */
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly canEdit: boolean;
}

export interface LyricsContext extends LibraryContext {
  readonly notify?: NotificationSink | undefined;
}

/** A person's saves within this long of their last one are one edit to the audit log. */
export const AUDIT_COALESCE_MINUTES = 15;

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

export async function readLyrics(context: LibraryContext, songId: string): Promise<LyricsView> {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, 'view')) refuse(`may not view song ${songId}`);
  await liveSong(context, songId);
  const [row] = await context.db
    .select({
      document: lyricsDocuments.document,
      version: lyricsDocuments.version,
      updatedAt: lyricsDocuments.updatedAt,
    })
    .from(lyricsDocuments)
    .where(
      and(eq(lyricsDocuments.workspaceId, context.workspaceId), eq(lyricsDocuments.songId, songId)),
    );
  return {
    document: (row?.document as LyricsDocument | undefined) ?? EMPTY_LYRICS,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? null,
    canEdit: permits(access, 'edit'),
  };
}

export async function saveLyrics(
  context: LyricsContext,
  songId: string,
  input: SaveLyricsRequest,
): Promise<{ readonly version: number }> {
  const parsed = saveLyricsSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  if (!isUlid(songId)) refuse('song id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  await liveSong(context, songId);

  const { document, baseVersion, yjsState } = parsed.data;
  const plainText = lyricsPlainText(document);
  const now = context.now ?? (() => new Date());

  const result = await withAuditedTransaction(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      now,
      newId: context.newId ?? newUlid,
    },
    async ({ tx, audit }) => {
      // Locked: two saves racing on the same version produce one save and one conflict.
      const [current] = await tx
        .select({
          id: lyricsDocuments.id,
          version: lyricsDocuments.version,
          updatedBy: lyricsDocuments.updatedBy,
          updatedAt: lyricsDocuments.updatedAt,
        })
        .from(lyricsDocuments)
        .where(
          and(
            eq(lyricsDocuments.workspaceId, context.workspaceId),
            eq(lyricsDocuments.songId, songId),
          ),
        )
        .for('update');
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== baseVersion) {
        throw conflict({
          detail: `lyrics for ${songId} are at version ${currentVersion}, not ${baseVersion}`,
        });
      }
      const version = currentVersion + 1;
      const values = {
        document,
        plainText,
        version,
        updatedBy: context.userId,
        // The service's clock, not the database's: the audit window below is measured with it.
        updatedAt: now(),
        ...(yjsState === undefined
          ? {}
          : {
              yjsState: yjsState === null ? null : Uint8Array.from(Buffer.from(yjsState, 'base64')),
            }),
      };
      if (current === undefined) {
        await tx.insert(lyricsDocuments).values({
          id: (context.newId ?? newUlid)(),
          workspaceId: context.workspaceId,
          songId,
          ...values,
        });
      } else {
        await tx.update(lyricsDocuments).set(values).where(eq(lyricsDocuments.id, current.id));
      }

      // Autosave writes every few seconds; the audit log records an editing session, not each
      // keystroke. A save by the same person within the window of their last is part of it.
      const continuing =
        current !== undefined &&
        current.updatedBy === context.userId &&
        now().getTime() - current.updatedAt.getTime() < AUDIT_COALESCE_MINUTES * 60_000;
      if (!continuing) {
        await audit({
          action: 'lyrics.updated',
          targetType: 'song',
          targetId: songId,
          metadata: { version, characters: plainText.length },
        });
      }
      return { version, announce: !continuing };
    },
  );

  if (result.announce) {
    await context.notify?.({
      event: 'lyrics.changed',
      targetType: 'song',
      targetId: songId,
      actorId: context.userId,
    });
  }
  return { version: result.version };
}
