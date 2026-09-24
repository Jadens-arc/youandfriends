import { permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  createThreadSchema,
  editCommentSchema,
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
  type ReplyRequest,
  type ResolveThreadRequest,
} from '@youandfriends/contracts';
import { comments, commentThreads, songs, users, type DirectDatabase } from '@youandfriends/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { LibraryContext } from '@/lib/library/context';
import type { NotificationSink } from '@/lib/library/metadata';

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
  readonly author: string | null;
  /** Empty for a deleted comment. */
  readonly body: string;
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
    return { kind: 'lyric', range: (row.anchorLyric ?? {}) as Record<string, unknown> };
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

  const byThread = new Map<string, CommentView[]>();
  for (const row of rows) {
    const deleted = row.tombstonedAt !== null;
    const mine = row.authorId === context.userId;
    const list = byThread.get(row.threadId) ?? [];
    list.push({
      id: row.id,
      author: row.author ?? null,
      body: deleted ? '' : row.body,
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
): Promise<{ readonly threadId: string; readonly commentId: string }> {
  const { anchor, body } = parse(createThreadSchema, input);
  // Timestamp and lyric anchors arrive with tasks `091` and `092`; the shape is ready, the
  // behaviour (checking the version, resolving the range) is not.
  if (anchor.kind !== 'general') {
    throw validationFailed([{ path: 'anchor', message: 'Only general comments for now.' }]);
  }
  await requireAccess(context, songId, 'comment');
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
        anchorKind: 'general',
        createdBy: context.userId,
        createdAt: at,
        updatedAt: at,
      });
      await tx.insert(comments).values({
        id: commentId,
        workspaceId: context.workspaceId,
        threadId,
        authorId: context.userId,
        body,
        createdAt: at,
      });
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, anchor: anchor.kind },
      });
      return { threadId, commentId };
    },
  );
  await context.notify?.({
    event: 'comment.created',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
  });
  return created;
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
): Promise<{ readonly commentId: string }> {
  const { body } = parse(replySchema, input);
  await requireAccess(context, songId, 'comment');
  const newId = context.newId ?? newUlid;
  const created = await withAuditedTransaction(
    context.db,
    auditContext(context),
    async ({ tx, audit }) => {
      await lockThread(tx, context, songId, threadId);
      const commentId = newId();
      const at = (context.now ?? (() => new Date()))();
      await tx.insert(comments).values({
        id: commentId,
        workspaceId: context.workspaceId,
        threadId,
        authorId: context.userId,
        body,
        createdAt: at,
      });
      await touch(tx, threadId, at);
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, reply: true },
      });
      return { commentId };
    },
  );
  await context.notify?.({
    event: 'comment.replied',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
  });
  return created;
}

async function lockComment(tx: Tx, context: LibraryContext, threadId: string, commentId: string) {
  if (!isUlid(commentId)) refuse('comment id is not a ULID');
  const [comment] = await tx
    .select({
      id: comments.id,
      authorId: comments.authorId,
      tombstonedAt: comments.tombstonedAt,
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
  context: LibraryContext,
  songId: string,
  threadId: string,
  commentId: string,
  input: EditCommentRequest,
): Promise<void> {
  const { body } = parse(editCommentSchema, input);
  await requireAccess(context, songId, 'comment');
  await withAuditedTransaction(context.db, auditContext(context), async ({ tx, audit }) => {
    await lockThread(tx, context, songId, threadId);
    const comment = await lockComment(tx, context, threadId, commentId);
    if (comment.authorId !== context.userId) refuse(`comment ${commentId} is not theirs`);
    if (comment.tombstonedAt !== null) refuse(`comment ${commentId} was deleted`);
    const at = (context.now ?? (() => new Date()))();
    await tx.update(comments).set({ body, editedAt: at }).where(eq(comments.id, commentId));
    await touch(tx, threadId, at);
    await audit({
      action: 'comment.updated',
      targetType: 'song',
      targetId: songId,
      metadata: { threadId, commentId },
    });
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
      .set({ body: '', tombstonedAt: at, tombstonedBy: context.userId })
      .where(eq(comments.id, commentId));
    await touch(tx, threadId, at);
    await audit({
      action: 'comment.deleted',
      targetType: 'song',
      targetId: songId,
      metadata: { threadId, commentId, byAuthor: comment.authorId === context.userId },
    });
  });
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
