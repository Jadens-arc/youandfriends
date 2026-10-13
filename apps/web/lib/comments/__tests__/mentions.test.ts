import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  commentMentions,
  commentReactions,
  comments,
  ensureScopeLimitedMembership,
  permissionGrants,
  songs,
  upsertGrant,
  users,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NotificationSink } from '@/lib/library/metadata';

import {
  createThread,
  deleteComment,
  editComment,
  listMentionable,
  listThreads,
  reply,
  setReaction,
  setResolved,
  type CommentsContext,
} from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING mention and reaction tests: ${reason}`);

type Notified = Parameters<NotificationSink>[0];

/**
 * Mentions, reactions, and resolution (task `094`) against a real database and the real resolver.
 *
 * The fixture holds the people who make the access rule bite: a scope-limited collaborator who
 * can open only "Headlights" (the narrow viewer of the autocomplete), a member **denied** on
 * Headlights, a scope-limited collaborator on the *other* song only, and a member of a foreign
 * workspace. Each of the last three is someone a careless list would leak, and a careless mention
 * would notify.
 */
describeWithDatabase('mentions, reactions, and resolution', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let clock = new Date('2026-10-13T12:00:00Z');
  const sent: Notified[] = [];
  const people = {} as Record<
    'owner' | 'sam' | 'viewer' | 'songOnly' | 'denied' | 'otherSongOnly' | 'foreign',
    string
  >;
  const ids = {} as Record<'song' | 'other' | 'foreignSong' | 'foreignWorkspace', string>;

  function contextFor(userId: string, workspace = workspaceId): CommentsContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      now: () => {
        clock = new Date(clock.getTime() + 1_000);
        return clock;
      },
      notify: async (event) => {
        sent.push(event);
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

  async function grantCount() {
    const [row] = await db.select({ n: count() }).from(permissionGrants);
    return row?.n ?? 0;
  }

  const general = (body: string) => ({ anchor: { kind: 'general' as const }, body });
  const mention = (userId: string) => `<@${userId}>`;

  beforeAll(async () => {
    database = await createTestDatabase('mentions');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    await db.update(users).set({ displayName: 'Avery Owner' }).where(eq(users.id, people.owner));
    const named = async (displayName: string) => {
      const user = await makeUser(db);
      await db.update(users).set({ displayName }).where(eq(users.id, user.id));
      return user.id;
    };
    people.sam = await named('Sam Rivera');
    people.viewer = await named('Val Viewer');
    people.songOnly = await named('Sol Narrow');
    people.denied = await named('Dee Denied');
    people.otherSongOnly = await named('Otto Elsewhere');
    people.foreign = await named('Fay Foreign');
    await addMember(db, workspaceId, people.sam, 'commenter');
    await addMember(db, workspaceId, people.viewer, 'viewer');
    await addMember(db, workspaceId, people.denied, 'commenter');

    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.other = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;

    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId,
      scopeType: 'song',
      scopeId: ids.song,
      subjectKind: 'member',
      subjectId: people.denied,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    await withTransaction(db, async (tx) => {
      for (const [userId, songId] of [
        [people.songOnly, ids.song],
        [people.otherSongOnly, ids.other],
      ] as const) {
        await ensureScopeLimitedMembership(tx, workspaceId, userId, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId,
          scopeType: 'song',
          scopeId: songId,
          subjectKind: 'member',
          subjectId: userId,
          role: 'commenter',
          canDownload: false,
          canInvite: false,
          createdByUserId: people.owner,
        });
      }
    });

    const foreign = await makeTenant(db);
    ids.foreignWorkspace = foreign.workspace.id;
    await addMember(db, foreign.workspace.id, people.foreign, 'editor');
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreignSong = (
      await makeSong(db, foreign.workspace.id, foreignProject.id, 'Unreleased')
    ).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('offers only the people who can open this song, decided on the server', async () => {
    const narrow = await listMentionable(contextFor(people.songOnly), ids.song);
    expect(narrow.people.map((person) => person.displayName)).toEqual([
      'Avery Owner',
      'Sam Rivera',
      'Val Viewer',
    ]);
    // Never the denied member, the other song's collaborator, the foreign member, or oneself.
    const offered = new Set(narrow.people.map((person) => person.userId));
    for (const hidden of [people.denied, people.otherSongOnly, people.foreign, people.songOnly]) {
      expect(offered.has(hidden)).toBe(false);
    }
    // The owner, by contrast, may mention the narrow collaborator: they can open it.
    const wide = await listMentionable(contextFor(people.owner), ids.song);
    expect(wide.people.map((person) => person.userId)).toContain(people.songOnly);
    // A viewer cannot comment, so is offered nobody; the other song's collaborator gets a 404.
    expect((await refusal(listMentionable(contextFor(people.viewer), ids.song))).publicCode).toBe(
      'not_found',
    );
    expect(
      (await refusal(listMentionable(contextFor(people.otherSongOnly), ids.song))).publicCode,
    ).toBe('not_found');
  });

  it('stores mentions as references that survive a rename, and notifies the mentioned', async () => {
    sent.length = 0;
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general(`${mention(people.songOnly)} can you check the bridge?`),
    );
    const [stored] = await db.select().from(comments).where(eq(comments.id, commentId));
    expect(stored?.body).toBe(`<@${people.songOnly}> can you check the bridge?`);
    expect(
      (await db.select().from(commentMentions).where(eq(commentMentions.commentId, commentId))).map(
        (row) => row.userId,
      ),
    ).toEqual([people.songOnly]);
    expect(sent).toContainEqual(
      expect.objectContaining({ event: 'comment.mentioned', recipientIds: [people.songOnly] }),
    );

    await db.update(users).set({ displayName: 'Sol Renamed' }).where(eq(users.id, people.songOnly));
    const thread = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.comments[0]?.mentions).toEqual([
      { userId: people.songOnly, displayName: 'Sol Renamed' },
    ]);
    await db.update(users).set({ displayName: 'Sol Narrow' }).where(eq(users.id, people.songOnly));
  });

  it('refuses a mention of anyone who cannot open the song, and grants nothing', async () => {
    const before = await grantCount();
    sent.length = 0;
    for (const outsider of [people.denied, people.otherSongOnly, people.foreign, testId()]) {
      const error = await refusal(
        createThread(contextFor(people.sam), ids.song, general(`${mention(outsider)} listen`)),
      );
      expect(error.publicCode).toBe('validation_failed');
      expect(JSON.stringify(error.fields)).toContain('cannot open this song');
    }
    expect(sent).toEqual([]);
    expect(await grantCount()).toBe(before);
    // And they still cannot open it: the mention was never an invitation.
    for (const outsider of [people.denied, people.otherSongOnly]) {
      const access = await createAuthorizer(db).resolveAccess(memberSubject(outsider as UserId), {
        workspaceId: workspaceId as WorkspaceId,
        scopeType: 'song',
        scopeId: ids.song,
      });
      expect(access.role).toBeNull();
    }
  });

  it('checks mentions in replies and edits too, notifying only the newly mentioned', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('A thought about the mix.'),
    );
    expect(
      (
        await refusal(
          reply(contextFor(people.sam), ids.song, threadId, {
            body: `${mention(people.otherSongOnly)} thoughts?`,
          }),
        )
      ).publicCode,
    ).toBe('validation_failed');
    expect(
      (
        await refusal(
          editComment(contextFor(people.sam), ids.song, threadId, commentId, {
            body: `${mention(people.denied)} thoughts?`,
          }),
        )
      ).publicCode,
    ).toBe('validation_failed');

    sent.length = 0;
    await editComment(contextFor(people.sam), ids.song, threadId, commentId, {
      body: `${mention(people.owner)} and ${mention(people.viewer)}, a thought.`,
    });
    await editComment(contextFor(people.sam), ids.song, threadId, commentId, {
      body: `${mention(people.owner)} and ${mention(people.songOnly)}, a thought.`,
    });
    const mentioned = sent
      .filter((event) => event.event === 'comment.mentioned')
      .map((event) => event.recipientIds);
    expect(mentioned).toEqual([[people.owner, people.viewer], [people.songOnly]]);
    const rows = await db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, commentId));
    expect(rows.map((row) => row.userId).sort()).toEqual([people.owner, people.songOnly].sort());
  });

  it('counts reactions per emoji, idempotently, and only from commenters', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('That take is the one.'),
    );
    const react = (userId: string, emoji: '🔥' | '👍', on: boolean) =>
      setReaction(contextFor(userId), ids.song, threadId, commentId, { emoji, on });
    await react(people.owner, '🔥', true);
    await react(people.owner, '🔥', true);
    await react(people.songOnly, '🔥', true);
    await react(people.songOnly, '👍', true);
    const view = async (userId: string) =>
      (await listThreads(contextFor(userId), ids.song)).threads
        .find((thread) => thread.id === threadId)
        ?.comments.find((comment) => comment.id === commentId)?.reactions;
    expect(await view(people.owner)).toEqual([
      { emoji: '👍', count: 1, mine: false, by: ['Sol Narrow'] },
      { emoji: '🔥', count: 2, mine: true, by: ['Avery Owner', 'Sol Narrow'] },
    ]);
    await react(people.owner, '🔥', false);
    await react(people.owner, '🔥', false);
    expect((await view(people.owner))?.find((reaction) => reaction.emoji === '🔥')).toEqual({
      emoji: '🔥',
      count: 1,
      mine: false,
      by: ['Sol Narrow'],
    });
    // A viewer may read reactions but not react; nobody reacts outside their workspace.
    expect((await refusal(react(people.viewer, '👍', true))).publicCode).toBe('not_found');
    expect(
      (
        await refusal(
          setReaction(
            contextFor(people.foreign, ids.foreignWorkspace),
            ids.song,
            threadId,
            commentId,
            {
              emoji: '👍',
              on: true,
            },
          ),
        )
      ).publicCode,
    ).toBe('not_found');
    // An emoji outside the fixed set is refused at the boundary.
    expect(
      (
        await refusal(
          setReaction(contextFor(people.owner), ids.song, threadId, commentId, {
            emoji: '💩' as '👍',
            on: true,
          }),
        )
      ).publicCode,
    ).toBe('validation_failed');
    // Deleting the comment takes its reactions and mentions with its words.
    await deleteComment(contextFor(people.sam), ids.song, threadId, commentId);
    const left = await db
      .select()
      .from(commentReactions)
      .where(eq(commentReactions.commentId, commentId));
    expect(left).toEqual([]);
    expect((await refusal(react(people.owner, '👍', true))).publicCode).toBe('not_found');
  });

  it('records who resolved a thread and when', async () => {
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('Fix the fade.'),
    );
    await setResolved(contextFor(people.songOnly), ids.song, threadId, { resolved: true });
    const thread = (await listThreads(contextFor(people.owner), ids.song)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.resolvedBy).toBe('Sol Narrow');
    expect(thread?.resolvedAt).toBeInstanceOf(Date);
  });

  it('purges a song with mentions and reactions on it', async () => {
    const doomed = await makeSong(
      db,
      workspaceId,
      (await makeProject(db, workspaceId, 'Gone')).id,
      'Doomed',
    );
    const { threadId, commentId } = await createThread(
      contextFor(people.owner),
      doomed.id,
      general(`${mention(people.sam)} last look`),
    );
    await setReaction(contextFor(people.sam), doomed.id, threadId, commentId, {
      emoji: '👀',
      on: true,
    });
    await db.delete(songs).where(eq(songs.id, doomed.id));
    expect(
      await db.select().from(commentMentions).where(eq(commentMentions.commentId, commentId)),
    ).toEqual([]);
    expect(
      await db.select().from(commentReactions).where(eq(commentReactions.commentId, commentId)),
    ).toEqual([]);
  });
});
