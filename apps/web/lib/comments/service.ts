import { permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  createThreadSchema,
  editCommentSchema,
  reactSchema,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  newUlid,
  replySchema,
  resolveThreadSchema,
  validationFailed,
  type CommentAnchor,
  type CreateThreadRequest,
  type EditCommentRequest,
  type ReactRequest,
  type ReplyRequest,
  type ResolveThreadRequest,
} from '@youandfriends/contracts';
import {
  assets,
  assetVersions,
  commentMentions,
  commentReactions,
  comments,
  commentThreads,
  mixVersions,
  songs,
  users,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { LibraryContext } from '@/lib/library/context';
import type { NotificationSink } from '@/lib/library/metadata';

import { mentionsOf, syncMentions, type Mentionable, type MentionOutcome } from './mentions';
import { reactionsOf, type ReactionView } from './reactions';
import { assertAttachableVoiceNote, type VoiceNoteView } from './voice-notes';

/**
 * The conversation on a song (task `090`).
 *
 * - Reading is `view` on the song; posting and resolving are `comment` (commenter and above).
 * - A comment is edited only by its author, while they may still comment.
 * - A comment is deleted by its author, or by anyone who may `edit` the song. Deleting erases the
 *   words and keeps the row as a tombstone, so the thread still reads as a conversation.
 * - A thread of another song, workspace, or a trashed song is 404-shaped, like everything else.
 *
 * Every write is audited against the song, so it joins the song's activity.
 */

export interface CommentsContext extends LibraryContext {
  readonly notify?: NotificationSink | undefined;
}

type EffectiveAccess = Awaited<ReturnType<LibraryContext['authz']['resolveAccess']>>;

type Tx = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

export interface CommentView {
  readonly id: string;
  /** Null once the author's account is gone. */
  readonly authorId: string | null;
  readonly author: string | null;
  /** Empty for a deleted comment — and may be empty when a voice note says it instead. */
  readonly body: string;
  /** The recording this comment carries (task `093`). */
  readonly voiceNote: VoiceNoteView | null;
  /** The people the body's `<@id>` references reached (task `094`), named as they are now. */
  readonly mentions: readonly Mentionable[];
  readonly reactions: readonly ReactionView[];
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deleted: boolean;
  readonly mine: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

export interface ThreadView {
  readonly id: string;
  readonly anchor: CommentAnchor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly comments: readonly CommentView[];
}

export interface CommentsView {
  readonly threads: readonly ThreadView[];
  readonly canComment: boolean;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  return parsed.data;
}

async function songAccess(context: LibraryContext, songId: string): Promise<EffectiveAccess> {
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
  return access;
}

async function requireAccess(context: LibraryContext, songId: string, action: 'comment' | 'edit') {
  const access = await songAccess(context, songId);
  if (!permits(access, action)) refuse(`may not ${action} song ${songId}`);
  return access;
}

function anchorOf(row: {
  anchorKind: 'general' | 'timestamp' | 'lyric';
  anchorVersionId: string | null;
  anchorMs: number | null;
  anchorLyric: unknown;
}): CommentAnchor {
  if (row.anchorKind === 'timestamp') {
    return { kind: 'timestamp', versionId: row.anchorVersionId ?? '', ms: row.anchorMs ?? 0 };
  }
  if (row.anchorKind === 'lyric') {
    const stored = (row.anchorLyric ?? {}) as Partial<Extract<CommentAnchor, { kind: 'lyric' }>>;
    return {
      kind: 'lyric',
      start: stored.start ?? {},
      end: stored.end ?? {},
      quote: stored.quote ?? '',
      scope: stored.scope ?? 'selection',
    };
  }
  return { kind: 'general' };
}

/** Every thread on a song, most recently active first, each with its comments in order. */
export async function listThreads(context: LibraryContext, songId: string): Promise<CommentsView> {
  const access = await songAccess(context, songId);
  const canComment = permits(access, 'comment');
  const canModerate = permits(access, 'edit');
  const resolver = alias(users, 'resolver');
  const threads = await context.db
    .select({
      id: commentThreads.id,
      anchorKind: commentThreads.anchorKind,
      anchorVersionId: commentThreads.anchorVersionId,
      anchorMs: commentThreads.anchorMs,
      anchorLyric: commentThreads.anchorLyric,
      createdAt: commentThreads.createdAt,
      updatedAt: commentThreads.updatedAt,
      resolvedAt: commentThreads.resolvedAt,
      resolvedBy: resolver.displayName,
    })
    .from(commentThreads)
    .leftJoin(resolver, eq(resolver.id, commentThreads.resolvedBy))
    .where(
      and(eq(commentThreads.workspaceId, context.workspaceId), eq(commentThreads.songId, songId)),
    )
    .orderBy(desc(commentThreads.updatedAt), desc(commentThreads.id))
    .limit(500);
  if (threads.length === 0) return { threads: [], canComment };

  const rows = await context.db
    .select({
      id: comments.id,
      threadId: comments.threadId,
      authorId: comments.authorId,
      author: users.displayName,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      tombstonedAt: comments.tombstonedAt,
      voiceNoteAssetId: comments.voiceNoteAssetId,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(
      and(
        eq(comments.workspaceId, context.workspaceId),
        inArray(
          comments.threadId,
          threads.map((thread) => thread.id),
        ),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));

  const live = rows.filter((row) => row.tombstonedAt === null).map((row) => row.id);
  const [voiceNotes, mentions, reactions] = await Promise.all([
    voiceNotesOf(
      context,
      rows.flatMap((row) =>
        row.voiceNoteAssetId === null || row.tombstonedAt !== null ? [] : [row.voiceNoteAssetId],
      ),
    ),
    mentionsOf(context, live),
    reactionsOf(context, live),
  ]);
  const byThread = new Map<string, CommentView[]>();
  for (const row of rows) {
    const deleted = row.tombstonedAt !== null;
    const mine = row.authorId === context.userId;
    const list = byThread.get(row.threadId) ?? [];
    list.push({
      id: row.id,
      authorId: row.authorId,
      author: row.author ?? null,
      body: deleted ? '' : row.body,
      voiceNote:
        deleted || row.voiceNoteAssetId === null
          ? null
          : (voiceNotes.get(row.voiceNoteAssetId) ?? null),
      mentions: deleted ? [] : (mentions.get(row.id) ?? []),
      reactions: deleted ? [] : (reactions.get(row.id) ?? []),
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deleted,
      mine,
      canEdit: !deleted && mine && canComment,
      canDelete: !deleted && ((mine && canComment) || canModerate),
    });
    byThread.set(row.threadId, list);
  }
  return {
    canComment,
    threads: threads.map((thread) => ({
      id: thread.id,
      anchor: anchorOf(thread),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      resolvedAt: thread.resolvedAt,
      resolvedBy: thread.resolvedBy ?? null,
      comments: byThread.get(thread.id) ?? [],
    })),
  };
}

function auditContext(context: LibraryContext) {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: context.now ?? (() => new Date()),
    newId: context.newId ?? newUlid,
  };
}

/** Start a thread with its first comment. */
export async function createThread(
  context: CommentsContext,
  songId: string,
  input: CreateThreadRequest,
): Promise<{
  readonly threadId: string;
  readonly commentId: string;
  readonly unreachedMentions: readonly string[];
}> {
  const { anchor, body, voiceNoteAssetId } = parse(createThreadSchema, input);
  await requireAccess(context, songId, 'comment');
  if (anchor.kind === 'timestamp') {
    // The moment belongs to the song; the version records what was playing when it was heard.
    // It must be one of this song's — never another song's, or another workspace's.
    const [version] = await context.db
      .select({ id: mixVersions.id })
      .from(mixVersions)
      .where(
        and(
          eq(mixVersions.id, anchor.versionId),
          eq(mixVersions.songId, songId),
          eq(mixVersions.workspaceId, context.workspaceId),
        ),
      );
    if (version === undefined) refuse(`version ${anchor.versionId} is not on song ${songId}`);
  }
  const newId = context.newId ?? newUlid;
  const created = await withAuditedTransaction(
    context.db,
    auditContext(context),
    async ({ tx, audit }) => {
      const threadId = newId();
      const commentId = newId();
      const at = (context.now ?? (() => new Date()))();
      await tx.insert(commentThreads).values({
        id: threadId,
        workspaceId: context.workspaceId,
        songId,
        anchorKind: anchor.kind,
        ...(anchor.kind === 'timestamp'
          ? { anchorVersionId: anchor.versionId, anchorMs: anchor.ms }
          : anchor.kind === 'lyric'
            ? {
                anchorLyric: {
                  start: anchor.start,
                  end: anchor.end,
                  quote: anchor.quote,
                  scope: anchor.scope,
                },
              }
            : {}),
        createdBy: context.userId,
        createdAt: at,
        updatedAt: at,
      });
      if (voiceNoteAssetId !== undefined) {
        await assertAttachableVoiceNote(tx, context, songId, voiceNoteAssetId);
      }
      await tx.insert(comments).values({
        id: commentId,
        workspaceId: context.workspaceId,
        threadId,
        authorId: context.userId,
        body,
        voiceNoteAssetId: voiceNoteAssetId ?? null,
        createdAt: at,
      });
      const mentioned = await syncMentions(tx, context, songId, commentId, body);
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: {
          threadId,
          commentId,
          anchor: anchor.kind,
          mentions: mentioned.newlyReached.length,
        },
      });
      return { threadId, commentId, mentioned };
    },
  );
  await context.notify?.({
    event: 'comment.created',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
  });
  await notifyMentioned(context, songId, created.mentioned);
  return {
    threadId: created.threadId,
    commentId: created.commentId,
    unreachedMentions: created.mentioned.unreached,
  };
}

async function lockThread(tx: Tx, context: LibraryContext, songId: string, threadId: string) {
  if (!isUlid(threadId)) refuse('thread id is not a ULID');
  const [thread] = await tx
    .select({ id: commentThreads.id, resolvedAt: commentThreads.resolvedAt })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.id, threadId),
        eq(commentThreads.workspaceId, context.workspaceId),
        eq(commentThreads.songId, songId),
      ),
    )
    .for('update');
  if (thread === undefined) refuse(`thread ${threadId} is not on song ${songId}`);
  return thread;
}

async function touch(tx: Tx, threadId: string, at: Date) {
  await tx.update(commentThreads).set({ updatedAt: at }).where(eq(commentThreads.id, threadId));
}

/** Reply within a thread. Replying to a resolved thread reopens nothing — it is still resolved. */
export async function reply(
  context: CommentsContext,
  songId: string,
  threadId: string,
  input: ReplyRequest,
): Promise<{ readonly commentId: string; readonly unreachedMentions: readonly string[] }> {
  const { body, voiceNoteAssetId } = parse(replySchema, input);
  await requireAccess(context, songId, 'comment');
  const newId = context.newId ?? newUlid;
  const created = await withAuditedTransaction(
    context.db,
    auditContext(context),
    async ({ tx, audit }) => {
      await lockThread(tx, context, songId, threadId);
      if (voiceNoteAssetId !== undefined) {
        await assertAttachableVoiceNote(tx, context, songId, voiceNoteAssetId);
      }
      const commentId = newId();
      const at = (context.now ?? (() => new Date()))();
      await tx.insert(comments).values({
        id: commentId,
        workspaceId: context.workspaceId,
        threadId,
        authorId: context.userId,
        body,
        voiceNoteAssetId: voiceNoteAssetId ?? null,
        createdAt: at,
      });
      await touch(tx, threadId, at);
      const mentioned = await syncMentions(tx, context, songId, commentId, body);
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, reply: true, mentions: mentioned.newlyReached.length },
      });
      return { commentId, mentioned };
    },
  );
  await context.notify?.({
    event: 'comment.replied',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
  });
  await notifyMentioned(context, songId, created.mentioned);
  return { commentId: created.commentId, unreachedMentions: created.mentioned.unreached };
}

async function lockComment(tx: Tx, context: LibraryContext, threadId: string, commentId: string) {
  if (!isUlid(commentId)) refuse('comment id is not a ULID');
  const [comment] = await tx
    .select({
      id: comments.id,
      authorId: comments.authorId,
      tombstonedAt: comments.tombstonedAt,
      voiceNoteAssetId: comments.voiceNoteAssetId,
    })
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.workspaceId, context.workspaceId),
        eq(comments.threadId, threadId),
      ),
    )
    .for('update');
  if (comment === undefined) refuse(`comment ${commentId} is not in thread ${threadId}`);
  return comment;
}

/** Change a comment's words — its author only, while they may still comment. */
export async function editComment(
  context: CommentsContext,
  songId: string,
  threadId: string,
  commentId: string,
  input: EditCommentRequest,
): Promise<{ readonly unreachedMentions: readonly string[] }> {
  const { body } = parse(editCommentSchema, input);
  await requireAccess(context, songId, 'comment');
  const mentioned = await withAuditedTransaction(
    context.db,
    auditContext(context),
    async ({ tx, audit }) => {
      await lockThread(tx, context, songId, threadId);
      const comment = await lockComment(tx, context, threadId, commentId);
      if (comment.authorId !== context.userId) refuse(`comment ${commentId} is not theirs`);
      if (comment.tombstonedAt !== null) refuse(`comment ${commentId} was deleted`);
      const at = (context.now ?? (() => new Date()))();
      await tx.update(comments).set({ body, editedAt: at }).where(eq(comments.id, commentId));
      await touch(tx, threadId, at);
      // Only people newly mentioned by the edit hear about it — not everyone again.
      const outcome = await syncMentions(tx, context, songId, commentId, body);
      await audit({
        action: 'comment.updated',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, mentions: outcome.newlyReached.length },
      });
      return outcome;
    },
  );
  await notifyMentioned(context, songId, mentioned);
  return { unreachedMentions: mentioned.unreached };
}

/** Tell the people a comment newly reached. Never the author: they know. */
async function notifyMentioned(context: CommentsContext, songId: string, outcome: MentionOutcome) {
  const recipientIds = outcome.newlyReached.filter((id) => id !== context.userId);
  if (recipientIds.length === 0) return;
  await context.notify?.({
    event: 'comment.mentioned',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
    recipientIds,
  });
}

/**
 * React to a comment, or take a reaction back — anyone who may comment, on a live comment.
 * Idempotent both ways, so a double press or a retried request settles on what was asked.
 * Not audited: a reaction changes no work and grants nothing.
 */
export async function react(
  context: LibraryContext,
  songId: string,
  threadId: string,
  commentId: string,
  input: ReactRequest,
): Promise<void> {
  const { reaction, on } = parse(reactSchema, input);
  await requireAccess(context, songId, 'comment');
  await context.db.transaction(async (tx) => {
    await lockThread(tx, context, songId, threadId);
    const comment = await lockComment(tx, context, threadId, commentId);
    if (comment.tombstonedAt !== null) refuse(`comment ${commentId} was deleted`);
    if (on) {
      await tx
        .insert(commentReactions)
        .values({
          id: (context.newId ?? newUlid)(),
          workspaceId: context.workspaceId,
          commentId,
          userId: context.userId,
          reaction,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.workspaceId, context.workspaceId),
            eq(commentReactions.userId, context.userId),
            eq(commentReactions.reaction, reaction),
          ),
        );
    }
  });
}

/**
 * Delete a comment: its author, or anyone who may edit the song. The words are erased; the row
 * stays as a tombstone so the thread keeps its shape.
 */
export async function deleteComment(
  context: LibraryContext,
  songId: string,
  threadId: string,
  commentId: string,
): Promise<void> {
  const access = await songAccess(context, songId);
  await withAuditedTransaction(context.db, auditContext(context), async ({ tx, audit }) => {
    await lockThread(tx, context, songId, threadId);
    const comment = await lockComment(tx, context, threadId, commentId);
    const mine = comment.authorId === context.userId && permits(access, 'comment');
    if (!mine && !permits(access, 'edit')) refuse(`may not delete comment ${commentId}`);
    if (comment.tombstonedAt !== null) return;
    const at = (context.now ?? (() => new Date()))();
    await tx
      .update(comments)
      .set({ body: '', voiceNoteAssetId: null, tombstonedAt: at, tombstonedBy: context.userId })
      .where(eq(comments.id, commentId));
    // The words are gone, and with them who they mentioned and how people answered them.
    for (const table of [commentMentions, commentReactions]) {
      await tx
        .delete(table)
        .where(and(eq(table.commentId, commentId), eq(table.workspaceId, context.workspaceId)));
    }
    // A voice note's words are the recording: it goes to the trash with the comment, and the
    // trash's purge removes the audio for good (task `028`).
    if (comment.voiceNoteAssetId !== null) {
      await tx
        .update(assets)
        .set({ deletedAt: at, deletedBy: context.userId })
        .where(
          and(eq(assets.id, comment.voiceNoteAssetId), eq(assets.workspaceId, context.workspaceId)),
        );
    }
    await touch(tx, threadId, at);
    await audit({
      action: 'comment.deleted',
      targetType: 'song',
      targetId: songId,
      metadata: { threadId, commentId, byAuthor: comment.authorId === context.userId },
    });
  });
}

/** Each voice note's duration and whether it can be played yet, from its recording. */
async function voiceNotesOf(
  context: LibraryContext,
  assetIds: readonly string[],
): Promise<Map<string, VoiceNoteView>> {
  const views = new Map<string, VoiceNoteView>();
  if (assetIds.length === 0) return views;
  const rows = await context.db
    .select({
      assetId: assetVersions.assetId,
      durationMs: assetVersions.durationMs,
      processingState: assetVersions.processingState,
    })
    .from(assetVersions)
    .where(
      and(
        eq(assetVersions.workspaceId, context.workspaceId),
        inArray(assetVersions.assetId, [...assetIds]),
      ),
    );
  for (const row of rows) {
    views.set(row.assetId, {
      assetId: row.assetId,
      durationMs: row.durationMs,
      state:
        row.processingState === 'complete'
          ? 'ready'
          : row.processingState === 'failed'
            ? 'failed'
            : 'processing',
    });
  }
  return views;
}

/** Resolve or reopen a thread — anyone who may comment. */
export async function setResolved(
  context: LibraryContext,
  songId: string,
  threadId: string,
  input: ResolveThreadRequest,
): Promise<void> {
  const { resolved } = parse(resolveThreadSchema, input);
  await requireAccess(context, songId, 'comment');
  await withAuditedTransaction(context.db, auditContext(context), async ({ tx, audit }) => {
    const thread = await lockThread(tx, context, songId, threadId);
    if ((thread.resolvedAt !== null) === resolved) return;
    const at = (context.now ?? (() => new Date()))();
    await tx
      .update(commentThreads)
      .set(
        resolved
          ? { resolvedAt: at, resolvedBy: context.userId, updatedAt: at }
          : { resolvedAt: null, resolvedBy: null, updatedAt: at },
      )
      .where(eq(commentThreads.id, threadId));
    await audit({
      action: resolved ? 'comment.resolved' : 'comment.reopened',
      targetType: 'song',
      targetId: songId,
      metadata: { threadId },
    });
  });
}
