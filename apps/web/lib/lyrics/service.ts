import { isDeepStrictEqual } from 'node:util';

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

import { documentFromYjs, fromBase64, mergeYjs, toBase64, yjsFromDocument } from './yjs';
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
  /**
   * The Yjs state to start a collaborative editor from (task `082`), base64: the stored one, or
   * — for lyrics never collaborated on — a deterministic seed, so two people opening them at once
   * start from one shared copy.
   */
  readonly yjsState: string;
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
      yjsState: lyricsDocuments.yjsState,
    })
    .from(lyricsDocuments)
    .where(
      and(eq(lyricsDocuments.workspaceId, context.workspaceId), eq(lyricsDocuments.songId, songId)),
    );
  const document = (row?.document as LyricsDocument | undefined) ?? EMPTY_LYRICS;
  return {
    document,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? null,
    canEdit: permits(access, 'edit'),
    yjsState: toBase64(row?.yjsState ?? yjsFromDocument(document)),
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
          document: lyricsDocuments.document,
          yjsState: lyricsDocuments.yjsState,
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
      let stored: LyricsDocument;
      let storedYjs: Uint8Array | null;
      if (typeof yjsState === 'string') {
        // Collaborative: merge into what is stored. The CRDT has already reconciled concurrent
        // edits, so there is no version to conflict with — two people's saves, in either order,
        // or the same save twice, produce the same document. The canonical JSON is derived from
        // the merged state rather than trusted from the request.
        const base =
          current?.yjsState ??
          (current === undefined ? null : yjsFromDocument(current.document as LyricsDocument));
        const incoming = fromBase64(yjsState);
        try {
          storedYjs = base === null ? mergeYjs(incoming) : mergeYjs(base, incoming);
          stored = documentFromYjs(storedYjs);
        } catch {
          throw validationFailed([{ path: 'yjsState', message: 'Not a lyrics document.' }]);
        }
      } else {
        if (currentVersion !== baseVersion) {
          throw conflict({
            detail: `lyrics for ${songId} are at version ${currentVersion}, not ${baseVersion}`,
          });
        }
        stored = document;
        // A single-player save supersedes any Yjs state, which would otherwise be stale.
        storedYjs = null;
      }
      const plainText = lyricsPlainText(stored);
      const version = currentVersion + 1;
      const values = {
        document: stored,
        plainText,
        version,
        updatedBy: context.userId,
        // The service's clock, not the database's: the audit window below is measured with it.
        updatedAt: now(),
        yjsState: storedYjs,
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

/**
 * The room's copy, merged into Postgres (task `082`) — the Liveblocks `ydocUpdated` webhook's
 * path, a second route to persistence beside every editor's own autosave, so a closed tab
 * between an edit and its save loses nothing.
 *
 * It only ever **merges** into a row an editor already created: the room carries only what
 * editors with write tokens wrote, and a merge cannot remove words that are stored. There is no
 * person here to audit — each author's own saves record the edit — so this writes no audit row
 * and leaves `updated_by` naming the last person who saved.
 */
export async function mergeRoomState(
  db: LibraryContext['db'],
  songId: string,
  update: Uint8Array,
): Promise<'merged' | 'unchanged' | 'no_lyrics'> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: lyricsDocuments.id,
        version: lyricsDocuments.version,
        document: lyricsDocuments.document,
        yjsState: lyricsDocuments.yjsState,
      })
      .from(lyricsDocuments)
      .innerJoin(
        songs,
        and(
          eq(songs.id, lyricsDocuments.songId),
          eq(songs.workspaceId, lyricsDocuments.workspaceId),
        ),
      )
      .where(and(eq(lyricsDocuments.songId, songId), isNull(songs.deletedAt)))
      .for('update', { of: lyricsDocuments });
    if (current === undefined) return 'no_lyrics';
    const base = current.yjsState ?? yjsFromDocument(current.document as LyricsDocument);
    const merged = mergeYjs(base, update);
    const document = documentFromYjs(merged);
    // Structural, not textual: jsonb does not keep key order.
    if (isDeepStrictEqual(document, current.document)) return 'unchanged';
    await tx
      .update(lyricsDocuments)
      .set({
        document,
        plainText: lyricsPlainText(document),
        version: current.version + 1,
        yjsState: merged,
        updatedAt: new Date(),
      })
      .where(eq(lyricsDocuments.id, current.id));
    return 'merged';
  });
}
