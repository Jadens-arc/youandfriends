import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  comments,
  commentThreads,
  songs,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAsset,
  makeAssetVersion,
  makeMixVersion,
  makeStorageObject,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '@/lib/library/context';

import {
  createThread,
  deleteComment,
  editComment,
  listThreads,
  reply,
  setResolved,
} from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING comment tests: ${reason}`);

/**
 * Comments (task `090`) against a real database and the real resolver. The fixture has a viewer
 * and a stranger, two commenters (so "someone else's comment" exists), an editor, and threads
 * that must stay out of reach: on a second song, on a trashed song, and in a foreign workspace.
 */
describeWithDatabase('comments', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let clock = new Date('2026-09-24T12:00:00Z');
  const people = {} as Record<'owner' | 'editor' | 'sam' | 'alex' | 'viewer' | 'stranger', string>;
  const ids = {} as Record<
    | 'song'
    | 'otherThread'
    | 'otherVersion'
    | 'trashed'
    | 'trashedThread'
    | 'foreignThread'
    | 'foreignSong'
    | 'foreignVersion',
    string
  >;

  function contextFor(userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      now: () => {
        clock = new Date(clock.getTime() + 1_000);
        return clock;
      },
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  async function threadRow(workspace: string, songId: string) {
    const id = testId();
    await db
      .insert(commentThreads)
      .values({ id, workspaceId: workspace, songId, anchorKind: 'general' });
    await db
      .insert(comments)
      .values({ id: testId(), workspaceId: workspace, threadId: id, body: 'hidden words' });
    return id;
  }

  /** A mix version of `songId`, with the storage rows it needs. */
  async function versionOf(songId: string, workspace = workspaceId) {
    const asset = await makeAsset(db, workspace, { songId }, { kind: 'mix' });
    const object = await makeStorageObject(db, workspace);
    const assetVersion = await makeAssetVersion(db, workspace, asset.id, object.id, 1);
    return (await makeMixVersion(db, workspace, songId, assetVersion.id, 1)).id;
  }

  const general = (body: string) => ({ anchor: { kind: 'general' as const }, body });

  beforeAll(async () => {
    database = await createTestDatabase('comments');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    const roles = {
      editor: 'editor',
      sam: 'commenter',
      alex: 'commenter',
      viewer: 'viewer',
    } as const;
    for (const [person, role] of Object.entries(roles)) {
      people[person as keyof typeof roles] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[person as keyof typeof roles], role);
    }
    people.stranger = (await makeUser(db)).id;
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    const other = await makeSong(db, workspaceId, project.id, 'Tail Lights');
    ids.otherThread = await threadRow(workspaceId, other.id);
    ids.otherVersion = await versionOf(other.id);
    ids.trashed = (await makeSong(db, workspaceId, project.id, 'Thrown Away')).id;
    ids.trashedThread = await threadRow(workspaceId, ids.trashed);
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, ids.trashed));
    const foreign = await makeTenant(db);
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreignSong = (
      await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')
    ).id;
    ids.foreignThread = await threadRow(foreign.workspace.id, ids.foreignSong);
    ids.foreignVersion = await versionOf(ids.foreignSong, foreign.workspace.id);
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('lets commenters start threads and viewers only read', async () => {
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('The second chorus drags.'),
    );
    expect(
      (await refusal(createThread(contextFor(people.viewer), ids.song, general('no')))).publicCode,
    ).toBe('not_found');
    const asViewer = await listThreads(contextFor(people.viewer), ids.song);
    expect(asViewer.canComment).toBe(false);
    expect(asViewer.threads.map((thread) => thread.id)).toEqual([threadId]);
    expect(asViewer.threads[0]?.comments[0]).toMatchObject({
      body: 'The second chorus drags.',
      canEdit: false,
      canDelete: false,
    });
    expect((await listThreads(contextFor(people.sam), ids.song)).canComment).toBe(true);
  });

  it('anchors a thread to a moment of one of this song’s versions, and no other', async () => {
    const mine = await versionOf(ids.song);
    const { threadId } = await createThread(contextFor(people.sam), ids.song, {
      anchor: { kind: 'timestamp', versionId: mine, ms: 102_000 },
      body: 'The snare here is too loud.',
    });
    const thread = (await listThreads(contextFor(people.viewer), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.anchor).toEqual({ kind: 'timestamp', versionId: mine, ms: 102_000 });
    // Another song's version, another workspace's, or none at all: 404-shaped.
    for (const versionId of [ids.otherVersion, ids.foreignVersion, testId()]) {
      const error = await refusal(
        createThread(contextFor(people.sam), ids.song, {
          anchor: { kind: 'timestamp', versionId, ms: 1_000 },
          body: 'at 0:01',
        }),
      );
      expect(error.publicCode).toBe('not_found');
    }
    const lyric = await refusal(
      createThread(contextFor(people.sam), ids.song, {
        anchor: { kind: 'lyric', start: {}, end: {}, quote: 'x'.repeat(501), scope: 'line' },
        body: 'this line',
      }),
    );
    expect(lyric.publicCode).toBe('validation_failed');
  });

  it('keeps replies in order and brings the busiest thread to the top', async () => {
    const first = await createThread(contextFor(people.sam), ids.song, general('Thread one'));
    const second = await createThread(contextFor(people.alex), ids.song, general('Thread two'));
    await reply(contextFor(people.alex), ids.song, first.threadId, { body: 'Agreed.' });
    await reply(contextFor(people.sam), ids.song, first.threadId, { body: 'Cutting it.' });
    const { threads } = await listThreads(contextFor(people.owner), ids.song);
    expect(threads[0]?.id).toBe(first.threadId);
    expect(threads[0]?.comments.map((comment) => comment.body)).toEqual([
      'Thread one',
      'Agreed.',
      'Cutting it.',
    ]);
    expect(threads.map((thread) => thread.id)).toContain(second.threadId);
  });

  it('lets only the author edit, marks the edit, and audits it', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('typo hre'),
    );
    for (const userId of [people.alex, people.editor, people.owner]) {
      const error = await refusal(
        editComment(contextFor(userId), ids.song, threadId, commentId, { body: 'x' }),
      );
      expect(error.publicCode).toBe('not_found');
    }
    await editComment(contextFor(people.sam), ids.song, threadId, commentId, { body: 'typo here' });
    const thread = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments[0]).toMatchObject({ body: 'typo here', deleted: false });
    expect(thread?.comments[0]?.editedAt).not.toBeNull();
    const audited = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'comment.updated'), eq(auditEvents.targetId, ids.song)));
    expect(audited).toHaveLength(1);
  });

  it('tombstones a deleted comment, erasing its words and keeping the thread whole', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('Opening words'),
    );
    const { commentId: replyId } = await reply(contextFor(people.alex), ids.song, threadId, {
      body: 'A reply',
    });
    // Another commenter may not delete it; the author may; an editor may delete anyone's.
    expect(
      (await refusal(deleteComment(contextFor(people.alex), ids.song, threadId, commentId)))
        .publicCode,
    ).toBe('not_found');
    await deleteComment(contextFor(people.sam), ids.song, threadId, commentId);
    await deleteComment(contextFor(people.sam), ids.song, threadId, commentId);
    await deleteComment(contextFor(people.editor), ids.song, threadId, replyId);

    const thread = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments.map((comment) => [comment.deleted, comment.body])).toEqual([
      [true, ''],
      [true, ''],
    ]);
    const [stored] = await db.select().from(comments).where(eq(comments.id, commentId));
    expect(stored?.body).toBe('');
    expect(stored?.tombstonedBy).toBe(people.sam);
    expect(
      (
        await refusal(
          editComment(contextFor(people.sam), ids.song, threadId, commentId, { body: 'back' }),
        )
      ).publicCode,
    ).toBe('not_found');
    const audited = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'comment.deleted'), eq(auditEvents.targetId, ids.song)));
    expect(audited).toHaveLength(2);
  });

  it('resolves and reopens threads, for anyone who may comment', async () => {
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('Fix the bridge'),
    );
    expect(
      (
        await refusal(
          setResolved(contextFor(people.viewer), ids.song, threadId, { resolved: true }),
        )
      ).publicCode,
    ).toBe('not_found');
    await setResolved(contextFor(people.alex), ids.song, threadId, { resolved: true });
    const resolved = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolvedBy).not.toBeNull();
    await setResolved(contextFor(people.sam), ids.song, threadId, { resolved: false });
    const reopened = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(reopened).toMatchObject({ resolvedAt: null, resolvedBy: null });
    const actions = (
      await db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.targetId, ids.song))
    ).map((row) => row.action);
    expect(actions).toContain('comment.resolved');
    expect(actions).toContain('comment.reopened');
  });

  it('never reaches a thread on another song, a trashed song, or another workspace', async () => {
    const owner = contextFor(people.owner);
    await createThread(contextFor(people.sam), ids.song, general('Here'));
    const [newest, older] = (await listThreads(owner, ids.song)).threads;
    const threadId = newest?.id ?? testId();
    // A real comment, but from a different thread than the one named.
    const commentId = older?.comments[0]?.id ?? testId();
    for (const foreignThread of [ids.otherThread, ids.trashedThread, ids.foreignThread]) {
      // Thunks, not promises: each attempt starts only when it is awaited.
      for (const attempt of [
        () => reply(owner, ids.song, foreignThread, { body: 'x' }),
        () => setResolved(owner, ids.song, foreignThread, { resolved: true }),
        () => deleteComment(owner, ids.song, foreignThread, commentId),
      ]) {
        expect((await refusal(attempt())).publicCode).toBe('not_found');
      }
    }
    expect((await refusal(deleteComment(owner, ids.song, threadId, commentId))).publicCode).toBe(
      'not_found',
    );
    for (const songId of [ids.trashed, ids.foreignSong]) {
      expect((await refusal(listThreads(owner, songId))).publicCode).toBe('not_found');
    }
    expect((await refusal(listThreads(contextFor(people.stranger), ids.song))).publicCode).toBe(
      'not_found',
    );
    const hidden = await db.select().from(comments).where(eq(comments.threadId, ids.foreignThread));
    expect(hidden[0]?.body).toBe('hidden words');
  });

  it('stores bodies as plain text, refusing control characters and empty or huge ones', async () => {
    const markup = '<img src=x onerror=alert(1)> **not bold**';
    const { threadId } = await createThread(contextFor(people.sam), ids.song, general(markup));
    const thread = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments[0]?.body).toBe(markup);
    for (const body of ['   ', 'x'.repeat(5_001), `bad${String.fromCharCode(0x202e)}text`]) {
      const error = await refusal(createThread(contextFor(people.sam), ids.song, general(body)));
      expect(error.publicCode).toBe('validation_failed');
    }
  });
});
