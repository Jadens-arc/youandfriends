import { loadSongCollaborators, permits, withAuditedTransaction } from '@youandfriends/authz';
import {
  createThreadSchema,
  editCommentSchema,
  fieldErrorsFromZod,
  COMMENT_REACTIONS,
  forbidden,
  isUlid,
  MAX_MENTIONS,
  mentionedUserIds,
  newUlid,
  reactionSchema,
  replySchema,
  resolveThreadSchema,
  validationFailed,
  type CommentAnchor,
  type CreateThreadRequest,
  type CommentReaction,
  type EditCommentRequest,
  type ReactionRequest,
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
  getSongHeader,
  mixVersions,
  songs,
  users,
  workspaceMemberships,
  type DirectDatabase,
  type NotificationLink,
} from '@youandfriends/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { LibraryContext } from '@/lib/library/context';
import type { NotificationSink } from '@/lib/library/metadata';

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
 * Every write is audited against the song, so it joins the song's activity — except reactions,
 * which are a tap, not a statement, and carry nothing anyone would later need to account for.
 *
 * Mentions (task `094`) are `<@userId>` tokens in the words, indexed in `comment_mentions`. A
 * mention may only name someone who can already open the song: it never grants access, and a
 * mention of anyone else is refused with a message telling the author so.
 */

export interface CommentsContext extends LibraryContext {
  readonly notify?: NotificationSink | undefined;
}

type EffectiveAccess = Awaited<ReturnType<LibraryContext['authz']['resolveAccess']>>;

type Tx = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

export interface CommentView {
  readonly id: string;
  readonly author: string | null;
  /** Empty for a deleted comment — and may be empty when a voice note says it instead. */
  readonly body: string;
  /** The recording this comment carries (task `093`). */
  readonly voiceNote: VoiceNoteView | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deleted: boolean;
  readonly mine: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** The people the words mention, by id, with their names as they are now. */
  readonly mentions: readonly MentionView[];
  /** One entry per emoji anyone has used, in the fixed order. */
  readonly reactions: readonly ReactionView[];
}

export interface MentionView {
  readonly userId: string;
  /** `null` when the person is no longer in the workspace. */
  readonly displayName: string | null;
}

export interface ReactionView {
  readonly emoji: CommentReaction;
  readonly count: number;
  readonly mine: boolean;
  /** Who reacted, by name, for the hover list and the screen reader. */
  readonly by: readonly string[];
}

export interface MentionableView {
  readonly userId: string;
  readonly displayName: string;
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

  const voiceNotes = await voiceNotesOf(
    context,
    rows.flatMap((row) =>
      row.voiceNoteAssetId === null || row.tombstonedAt !== null ? [] : [row.voiceNoteAssetId],
    ),
  );
  const live = rows.filter((row) => row.tombstonedAt === null).map((row) => row.id);
  const [mentions, reactions] = await Promise.all([
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
      author: row.author ?? null,
      body: deleted ? '' : row.body,
      voiceNote:
        deleted || row.voiceNoteAssetId === null
          ? null
          : (voiceNotes.get(row.voiceNoteAssetId) ?? null),
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deleted,
      mine,
      canEdit: !deleted && mine && canComment,
      canDelete: !deleted && ((mine && canComment) || canModerate),
      mentions: deleted ? [] : (mentions.get(row.id) ?? []),
      reactions: deleted ? [] : (reactions.get(row.id) ?? []),
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

/** Each live comment's mentions, with the person's name as it is now. */
async function mentionsOf(
  context: LibraryContext,
  commentIds: readonly string[],
): Promise<Map<string, MentionView[]>> {
  const result = new Map<string, MentionView[]>();
  if (commentIds.length === 0) return result;
  const rows = await context.db
    .select({
      commentId: commentMentions.commentId,
      userId: commentMentions.userId,
      displayName: users.displayName,
      member: workspaceMemberships.userId,
    })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.userId, commentMentions.userId),
        eq(workspaceMemberships.workspaceId, context.workspaceId),
      ),
    )
    .where(
      and(
        eq(commentMentions.workspaceId, context.workspaceId),
        inArray(commentMentions.commentId, [...commentIds]),
      ),
    );
  for (const row of rows) {
    const list = result.get(row.commentId) ?? [];
    // Someone who has left the workspace is shown as "someone": their name is no longer ours.
    list.push({ userId: row.userId, displayName: row.member === null ? null : row.displayName });
    result.set(row.commentId, list);
  }
  return result;
}

/** Each live comment's reactions, grouped by emoji in the fixed order. */
async function reactionsOf(
  context: LibraryContext,
  commentIds: readonly string[],
): Promise<Map<string, ReactionView[]>> {
  const result = new Map<string, ReactionView[]>();
  if (commentIds.length === 0) return result;
  const rows = await context.db
    .select({
      commentId: commentReactions.commentId,
      userId: commentReactions.userId,
      emoji: commentReactions.emoji,
      displayName: users.displayName,
    })
    .from(commentReactions)
    .innerJoin(users, eq(users.id, commentReactions.userId))
    .where(
      and(
        eq(commentReactions.workspaceId, context.workspaceId),
        inArray(commentReactions.commentId, [...commentIds]),
      ),
    )
    .orderBy(asc(commentReactions.createdAt), asc(commentReactions.userId));
  const grouped = new Map<string, Map<string, { by: string[]; mine: boolean }>>();
  for (const row of rows) {
    const byEmoji =
      grouped.get(row.commentId) ?? new Map<string, { by: string[]; mine: boolean }>();
    const entry = byEmoji.get(row.emoji) ?? { by: [], mine: false };
    entry.by.push(row.displayName);
    if (row.userId === context.userId) entry.mine = true;
    byEmoji.set(row.emoji, entry);
    grouped.set(row.commentId, byEmoji);
  }
  for (const [commentId, byEmoji] of grouped) {
    result.set(
      commentId,
      COMMENT_REACTIONS.flatMap((emoji) => {
        const entry = byEmoji.get(emoji);
        return entry === undefined
          ? []
          : [{ emoji, count: entry.by.length, mine: entry.mine, by: entry.by }];
      }),
    );
  }
  return result;
}

/** Who can open a song: the only people a mention may name. Server-side, from the resolver. */
async function songReach(context: LibraryContext, songId: string): Promise<Set<string>> {
  const header = await getSongHeader(context.db, context.workspaceId, songId);
  if (header === null) refuse(`song ${songId} is not live`);
  const reach = await loadSongCollaborators(
    context.db,
    context.workspaceId,
    { id: songId, projectId: header.projectId, folderPath: header.folderPath },
    context.now ?? (() => new Date()),
  );
  return new Set(reach);
}

/**
 * The people a commenter may mention on this song (task `094`): everyone who can open it, and
 * nobody else. The list is membership information (threat model asset 3), so it is filtered here,
 * on the server, to the song — never the whole workspace — and offered only to commenters.
 */
export async function listMentionable(
  context: LibraryContext,
  songId: string,
): Promise<{ readonly people: readonly MentionableView[] }> {
  await requireAccess(context, songId, 'comment');
  const reach = await songReach(context, songId);
  reach.delete(context.userId);
  if (reach.size === 0) return { people: [] };
  const rows = await context.db
    .select({ userId: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...reach]))
    .orderBy(asc(users.displayName), asc(users.id));
  return { people: rows };
}

/**
 * The people these words mention, each checked against who can open the song. A mention never
 * grants access: naming someone who cannot open the song is refused, and the author is told why,
 * rather than notifying a person who would only meet a 404.
 */
async function checkedMentions(
  context: LibraryContext,
  songId: string,
  body: string,
): Promise<string[]> {
  const mentioned = mentionedUserIds(body);
  if (mentioned.length === 0) return [];
  if (mentioned.length > MAX_MENTIONS) {
    throw validationFailed([
      { path: 'body', message: `Mention at most ${MAX_MENTIONS} people in one comment.` },
    ]);
  }
  const reach = await songReach(context, songId);
  if (mentioned.some((userId) => !reach.has(userId))) {
    throw validationFailed([
      {
        path: 'body',
        message:
          'Someone you mentioned cannot open this song. A mention does not give access — share the song with them first.',
      },
    ]);
  }
  return mentioned;
}

async function recordMentions(
  tx: Tx,
  context: LibraryContext,
  commentId: string,
  userIds: readonly string[],
  at: Date,
) {
  if (userIds.length === 0) return;
  await tx
    .insert(commentMentions)
    .values(
      userIds.map((userId) => ({
        id: (context.newId ?? newUlid)(),
        workspaceId: context.workspaceId,
        commentId,
        userId,
        createdAt: at,
      })),
    )
    .onConflictDoNothing();
}

async function notifyMentioned(
  context: CommentsContext,
  songId: string,
  recipientIds: readonly string[],
  about: { readonly preview: string; readonly link: NotificationLink },
) {
  const others = recipientIds.filter((userId) => userId !== context.userId);
  if (others.length === 0) return;
  await context.notify?.({
    event: 'comment.mentioned',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
    recipientIds: others,
    preview: about.preview,
    link: about.link,
  });
}

/** Where a notification about a thread lands (task `095`): the thread, on its own tab. */
function threadLink(threadId: string, anchor: CommentAnchor['kind']): NotificationLink {
  return { threadId, anchor, tab: anchor === 'lyric' ? 'lyrics' : 'activity' };
}

/** A comment's glimpse for a notification: its words, or that it is a voice note. */
function previewOf(body: string, voiceNote: boolean): string {
  return body.trim() === '' && voiceNote ? 'A voice note' : body;
}

async function threadAnchor(context: LibraryContext, threadId: string) {
  const [row] = await context.db
    .select({ anchorKind: commentThreads.anchorKind })
    .from(commentThreads)
    .where(
      and(eq(commentThreads.id, threadId), eq(commentThreads.workspaceId, context.workspaceId)),
    );
  return row?.anchorKind ?? 'general';
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
  const { anchor, body, voiceNoteAssetId } = parse(createThreadSchema, input);
  await requireAccess(context, songId, 'comment');
  const mentioned = await checkedMentions(context, songId, body);
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
      await recordMentions(tx, context, commentId, mentioned, at);
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, anchor: anchor.kind, mentions: mentioned.length },
      });
      return { threadId, commentId };
    },
  );
  const about = {
    preview: previewOf(body, voiceNoteAssetId !== undefined),
    link: threadLink(created.threadId, anchor.kind),
  };
  await context.notify?.({
    event: voiceNoteAssetId === undefined ? 'comment.created' : 'voice_note.created',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
    ...about,
  });
  await notifyMentioned(context, songId, mentioned, about);
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
  const { body, voiceNoteAssetId } = parse(replySchema, input);
  await requireAccess(context, songId, 'comment');
  const mentioned = await checkedMentions(context, songId, body);
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
      await recordMentions(tx, context, commentId, mentioned, at);
      await touch(tx, threadId, at);
      await audit({
        action: 'comment.created',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId, reply: true, mentions: mentioned.length },
      });
      return { commentId };
    },
  );
  const about = {
    preview: previewOf(body, voiceNoteAssetId !== undefined),
    link: threadLink(threadId, await threadAnchor(context, threadId)),
  };
  await context.notify?.({
    event: voiceNoteAssetId === undefined ? 'comment.replied' : 'voice_note.created',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
    ...about,
  });
  await notifyMentioned(context, songId, mentioned, about);
  return created;
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
): Promise<void> {
  const { body } = parse(editCommentSchema, input);
  await requireAccess(context, songId, 'comment');
  const mentioned = await checkedMentions(context, songId, body);
  const added = await withAuditedTransaction(
    context.db,
    auditContext(context),
    async ({ tx, audit }) => {
      await lockThread(tx, context, songId, threadId);
      const comment = await lockComment(tx, context, threadId, commentId);
      if (comment.authorId !== context.userId) refuse(`comment ${commentId} is not theirs`);
      if (comment.tombstonedAt !== null) refuse(`comment ${commentId} was deleted`);
      const at = (context.now ?? (() => new Date()))();
      await tx.update(comments).set({ body, editedAt: at }).where(eq(comments.id, commentId));
      // The index follows the words: mentions taken out are dropped, new ones recorded.
      const before = await tx
        .select({ userId: commentMentions.userId })
        .from(commentMentions)
        .where(
          and(
            eq(commentMentions.workspaceId, context.workspaceId),
            eq(commentMentions.commentId, commentId),
          ),
        );
      const had = new Set(before.map((row) => row.userId));
      const dropped = [...had].filter((userId) => !mentioned.includes(userId));
      if (dropped.length > 0) {
        await tx
          .delete(commentMentions)
          .where(
            and(
              eq(commentMentions.workspaceId, context.workspaceId),
              eq(commentMentions.commentId, commentId),
              inArray(commentMentions.userId, dropped),
            ),
          );
      }
      const fresh = mentioned.filter((userId) => !had.has(userId));
      await recordMentions(tx, context, commentId, fresh, at);
      await touch(tx, threadId, at);
      await audit({
        action: 'comment.updated',
        targetType: 'song',
        targetId: songId,
        metadata: { threadId, commentId },
      });
      return fresh;
    },
  );
  // Only people newly mentioned hear about an edit; nobody is told twice.
  if (added.length > 0) {
    await notifyMentioned(context, songId, added, {
      preview: body,
      link: threadLink(threadId, await threadAnchor(context, threadId)),
    });
  }
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
    // The words are gone, and with them who they named and how anyone felt about them.
    await tx
      .delete(commentMentions)
      .where(
        and(
          eq(commentMentions.workspaceId, context.workspaceId),
          eq(commentMentions.commentId, commentId),
        ),
      );
    await tx
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.workspaceId, context.workspaceId),
          eq(commentReactions.commentId, commentId),
        ),
      );
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

/**
 * Add or take back one reaction (task `094`) — anyone who may comment, on a live comment. Both
 * directions are idempotent, so a double tap or a retried request lands where it was meant to.
 */
export async function setReaction(
  context: LibraryContext,
  songId: string,
  threadId: string,
  commentId: string,
  input: ReactionRequest,
): Promise<void> {
  const { emoji, on } = parse(reactionSchema, input);
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
          emoji,
          createdAt: (context.now ?? (() => new Date()))(),
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.workspaceId, context.workspaceId),
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, context.userId),
            eq(commentReactions.emoji, emoji),
          ),
        );
    }
  });
}
