import { permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  createCheckpointSchema,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  lyricsPlainText,
  newUlid,
  validationFailed,
  type CreateCheckpointRequest,
  type LyricsDocument,
} from '@youandfriends/contracts';
import {
  lyricsDocuments,
  lyricsRevisions,
  songs,
  users,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

import { revisionsToThin, shouldSnapshot } from './revisions-policy';
import { documentFromYjs, toBase64, yjsFromDocument, yjsReplace } from './yjs';

/**
 * Lyric revisions (task `084`): automatic snapshots on meaningful change, named checkpoints, and
 * restoration that **never destroys current work** — what was there is kept as a revision first,
 * so a restore can itself be restored away.
 *
 * Reads are `view` on the song, like the lyrics themselves; checkpoints and restores are `edit`,
 * audited. A revision of another song, another workspace, or a trashed song is 404-shaped.
 */

type Tx = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

export type RevisionKind = 'automatic' | 'checkpoint' | 'before_restore';

export interface RevisionSummary {
  readonly id: string;
  readonly kind: RevisionKind;
  readonly name: string | null;
  readonly createdAt: Date;
  /** Who made it — for an automatic revision, whose save it came from. */
  readonly author: string | null;
}

export interface RevisionDetail extends RevisionSummary {
  readonly document: LyricsDocument;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

async function requireSong(context: LibraryContext, songId: string, action: 'view' | 'edit') {
  if (!isUlid(songId)) refuse('song id is not a ULID');
  const access = await context.authz.resolveAccess(context.subject, {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });
  if (!permits(access, action)) refuse(`may not ${action} song ${songId}`);
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

/**
 * Called by the save path, inside its transaction, after the lyrics are written: leave an
 * automatic revision if the policy says this save is one worth keeping, then thin the older ones.
 */
export async function snapshotIfDue(
  tx: Tx,
  input: {
    readonly workspaceId: string;
    readonly songId: string;
    readonly document: LyricsDocument;
    readonly plainText: string;
    readonly version: number;
    readonly userId: string;
    readonly now: Date;
    readonly lifecycle: boolean;
    readonly newId: () => string;
  },
): Promise<boolean> {
  const [last] = await tx
    .select({ createdAt: lyricsRevisions.createdAt, plainText: lyricsRevisions.plainText })
    .from(lyricsRevisions)
    .where(
      and(
        eq(lyricsRevisions.workspaceId, input.workspaceId),
        eq(lyricsRevisions.songId, input.songId),
      ),
    )
    .orderBy(desc(lyricsRevisions.createdAt), desc(lyricsRevisions.id))
    .limit(1);
  if (
    !shouldSnapshot({
      last: last ?? null,
      plainText: input.plainText,
      now: input.now,
      lifecycle: input.lifecycle,
    })
  ) {
    return false;
  }
  await tx.insert(lyricsRevisions).values({
    id: input.newId(),
    workspaceId: input.workspaceId,
    songId: input.songId,
    kind: 'automatic',
    document: input.document,
    plainText: input.plainText,
    sourceVersion: input.version,
    createdBy: input.userId,
    createdAt: input.now,
  });
  await thin(tx, input.workspaceId, input.songId, input.now);
  return true;
}

async function thin(tx: Tx, workspaceId: string, songId: string, now: Date) {
  const automatic = await tx
    .select({
      id: lyricsRevisions.id,
      kind: lyricsRevisions.kind,
      createdAt: lyricsRevisions.createdAt,
    })
    .from(lyricsRevisions)
    .where(
      and(
        eq(lyricsRevisions.workspaceId, workspaceId),
        eq(lyricsRevisions.songId, songId),
        eq(lyricsRevisions.kind, 'automatic'),
      ),
    );
  const remove = revisionsToThin(automatic, now);
  if (remove.length === 0) return;
  await tx
    .delete(lyricsRevisions)
    .where(
      and(
        eq(lyricsRevisions.workspaceId, workspaceId),
        eq(lyricsRevisions.kind, 'automatic'),
        inArray(lyricsRevisions.id, remove),
      ),
    );
}

/** A song's revisions, newest first. */
export async function listRevisions(
  context: LibraryContext,
  songId: string,
): Promise<RevisionSummary[]> {
  await requireSong(context, songId, 'view');
  const rows = await context.db
    .select({
      id: lyricsRevisions.id,
      kind: lyricsRevisions.kind,
      name: lyricsRevisions.name,
      createdAt: lyricsRevisions.createdAt,
      author: users.displayName,
    })
    .from(lyricsRevisions)
    .leftJoin(users, eq(users.id, lyricsRevisions.createdBy))
    .where(
      and(eq(lyricsRevisions.workspaceId, context.workspaceId), eq(lyricsRevisions.songId, songId)),
    )
    .orderBy(desc(lyricsRevisions.createdAt), desc(lyricsRevisions.id))
    .limit(500);
  return rows.map((row) => ({ ...row, author: row.author ?? null }));
}

async function findRevision(
  db: LibraryContext['db'] | Tx,
  workspaceId: string,
  songId: string,
  revisionId: string,
) {
  if (!isUlid(revisionId)) refuse('revision id is not a ULID');
  const [row] = await db
    .select({
      id: lyricsRevisions.id,
      kind: lyricsRevisions.kind,
      name: lyricsRevisions.name,
      createdAt: lyricsRevisions.createdAt,
      document: lyricsRevisions.document,
      author: users.displayName,
    })
    .from(lyricsRevisions)
    .leftJoin(users, eq(users.id, lyricsRevisions.createdBy))
    .where(
      and(
        eq(lyricsRevisions.id, revisionId),
        eq(lyricsRevisions.workspaceId, workspaceId),
        eq(lyricsRevisions.songId, songId),
      ),
    );
  if (row === undefined) refuse(`revision ${revisionId} is not on song ${songId}`);
  return { ...row, author: row.author ?? null, document: row.document as LyricsDocument };
}

export async function readRevision(
  context: LibraryContext,
  songId: string,
  revisionId: string,
): Promise<RevisionDetail> {
  await requireSong(context, songId, 'view');
  return findRevision(context.db, context.workspaceId, songId, revisionId);
}

/** Name the lyrics as they are now. */
export async function createCheckpoint(
  context: LibraryContext,
  songId: string,
  input: CreateCheckpointRequest,
): Promise<RevisionSummary> {
  const parsed = createCheckpointSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  await requireSong(context, songId, 'edit');
  const now = context.now ?? (() => new Date());
  const newId = context.newId ?? newUlid;
  return withAuditedTransaction(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      now,
      newId,
    },
    async ({ tx, audit }) => {
      const [current] = await tx
        .select({
          document: lyricsDocuments.document,
          plainText: lyricsDocuments.plainText,
          version: lyricsDocuments.version,
        })
        .from(lyricsDocuments)
        .where(
          and(
            eq(lyricsDocuments.workspaceId, context.workspaceId),
            eq(lyricsDocuments.songId, songId),
          ),
        );
      if (current === undefined) {
        throw validationFailed([
          { path: 'name', message: 'There are no lyrics to checkpoint yet.' },
        ]);
      }
      const id = newId();
      const createdAt = now();
      await tx.insert(lyricsRevisions).values({
        id,
        workspaceId: context.workspaceId,
        songId,
        kind: 'checkpoint',
        name: parsed.data.name,
        document: current.document,
        plainText: current.plainText,
        sourceVersion: current.version,
        createdBy: context.userId,
        createdAt,
      });
      await audit({
        action: 'lyrics.checkpoint_created',
        targetType: 'song',
        targetId: songId,
        metadata: { revisionId: id, version: current.version },
      });
      return { id, kind: 'checkpoint', name: parsed.data.name, createdAt, author: null };
    },
  );
}

export interface RestoreResult {
  readonly version: number;
  readonly document: LyricsDocument;
  /**
   * The restore as a Yjs update, base64: applied to a collaborative editor's document, it reaches
   * everyone in the room — the restore propagates instead of silently diverging.
   */
  readonly yjsUpdate: string;
  /** The revision holding what was there before, so the restore can be undone. */
  readonly beforeRevisionId: string;
}

function describe(revision: { name: string | null; createdAt: Date }): string {
  if (revision.name !== null) return `“${revision.name}”`;
  return revision.createdAt.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * Restore an earlier draft. First, what is there now is kept as a `before_restore` revision; then
 * the lyrics become the revision's — as an edit of the stored Yjs state, so a collaborative room
 * applying it lands on the same document.
 */
export async function restoreRevision(
  context: LibraryContext,
  songId: string,
  revisionId: string,
): Promise<RestoreResult> {
  await requireSong(context, songId, 'edit');
  const now = context.now ?? (() => new Date());
  const newId = context.newId ?? newUlid;
  return withAuditedTransaction(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      now,
      newId,
    },
    async ({ tx, audit }) => {
      const revision = await findRevision(tx, context.workspaceId, songId, revisionId);
      const [current] = await tx
        .select({
          id: lyricsDocuments.id,
          document: lyricsDocuments.document,
          plainText: lyricsDocuments.plainText,
          version: lyricsDocuments.version,
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
      if (current === undefined) refuse(`song ${songId} has no lyrics to restore over`);

      // 1. Keep what is there now. This is the whole point: a restore is undoable.
      const beforeRevisionId = newId();
      const at = now();
      await tx.insert(lyricsRevisions).values({
        id: beforeRevisionId,
        workspaceId: context.workspaceId,
        songId,
        kind: 'before_restore',
        name: `Before restoring ${describe(revision)}`,
        document: current.document,
        plainText: current.plainText,
        sourceVersion: current.version,
        createdBy: context.userId,
        createdAt: at,
      });

      // 2. Become the revision, as an edit of the stored Yjs state.
      const base = current.yjsState ?? yjsFromDocument(current.document as LyricsDocument);
      const { update, merged } = yjsReplace(base, revision.document);
      const document = documentFromYjs(merged);
      const version = current.version + 1;
      await tx
        .update(lyricsDocuments)
        .set({
          document,
          plainText: lyricsPlainText(document),
          yjsState: merged,
          version,
          updatedBy: context.userId,
          updatedAt: at,
        })
        .where(eq(lyricsDocuments.id, current.id));
      await audit({
        action: 'lyrics.revision_restored',
        targetType: 'song',
        targetId: songId,
        metadata: { revisionId, beforeRevisionId, version },
      });
      return { version, document, yjsUpdate: toBase64(update), beforeRevisionId };
    },
  );
}

/** For the history panel: how a revision is named when nobody named it. */
export function revisionLabel(revision: Pick<RevisionSummary, 'kind' | 'name'>): string {
  if (revision.name !== null) return revision.name;
  return revision.kind === 'automatic' ? 'Automatic snapshot' : 'Earlier draft';
}
