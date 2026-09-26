import { createAuthorizer, memberSubject, permits } from '@youandfriends/authz';
import type { AppError, UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  commentMentions,
  commentReactions,
  ensureScopeLimitedMembership,
  permissionGrants,
  upsertGrant,
  users,
  withTransaction,
  workspaceMemberships,
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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NotificationSink } from '@/lib/library/metadata';

import { listMentionable } from '../mentions';
import {
  createThread,
  deleteComment,
  editComment,
  listThreads,
  react,
  reply,
  setResolved,
  type CommentsContext,
} from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING mention and reaction tests: ${reason}`);

type Person = 'owner' | 'sam' | 'alex' | 'viewer' | 'nina' | 'dana' | 'oscar' | 'stranger';

/**
 * Mentions and reactions (task `094`) against a real database and the real resolver.
 *
 * The fixture is built so each rule has someone to refuse. On Headlights:
 *
 * - `nina` can reach **only** this song, through a song grant — the narrowly scoped collaborator
 *   whose autocomplete must not become a workspace directory;
 * - `dana` is a workspace editor **denied** on it — a member who must not be listed;
 * - `oscar` can reach only Tail Lights — a member with access elsewhere, the mention that must
 *   grant nothing;
 * - `stranger` belongs to another workspace entirely.
 */
describeWithDatabase('mentions and reactions', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<Person, string>;
  const ids = {} as Record<'headlights' | 'tailLights' | 'foreignSong', string>;
  const events: Parameters<NotificationSink>[0][] = [];

  function contextFor(userId: string): CommentsContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      notify: async (event) => {
        events.push(event);
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

  const at = (person: Person) => `<@${people[person]}>`;
  const general = (body: string) => ({ anchor: { kind: 'general' as const }, body });

  async function songGrant(userId: string, songId: string) {
    await withTransaction(db, async (tx) => {
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
    });
  }

  /** A person with a name to see in lists — the factory gives everyone the same one. */
  async function named(displayName: string) {
    const user = await makeUser(db);
    await db.update(users).set({ displayName }).where(eq(users.id, user.id));
    return user.id;
  }

  async function accessOf(userId: string, songId: string) {
    return createAuthorizer(db).resolveAccess(memberSubject(userId as UserId), {
      workspaceId: workspaceId as WorkspaceId,
      scopeType: 'song',
      scopeId: songId,
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase('mentions');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    people.owner = tenant.user.id;
    for (const [person, role] of [
      ['sam', 'commenter'],
      ['alex', 'commenter'],
      ['viewer', 'viewer'],
      ['dana', 'editor'],
    ] as const) {
      people[person] = await named(person);
      await addMember(db, workspaceId, people[person], role);
    }
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.headlights = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.tailLights = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    people.nina = await named('nina');
    await songGrant(people.nina, ids.headlights);
    people.oscar = await named('oscar');
    await songGrant(people.oscar, ids.tailLights);
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId,
      scopeType: 'song',
      scopeId: ids.headlights,
      subjectKind: 'member',
      subjectId: people.dana,
      role: null,
      isDeny: true,
      createdByUserId: people.owner,
    });
    const foreign = await makeTenant(db);
    people.stranger = foreign.user.id;
    const foreignProject = await makeProject(db, foreign.workspace.id, 'Theirs');
    ids.foreignSong = (await makeSong(db, foreign.workspace.id, foreignProject.id, 'X')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('offers only the people who can see this song — even to someone who sees nothing else', async () => {
    const offered = async (who: Person) =>
      (await listMentionable(contextFor(people[who]), ids.headlights)).map((person) => person.id);
    const reach = [people.owner, people.sam, people.alex, people.viewer, people.nina];
    expect(new Set(await offered('nina'))).toEqual(
      new Set(reach.filter((id) => id !== people.nina)),
    );
    // The denied editor, the member with access elsewhere, and the stranger are never listed.
    for (const who of ['nina', 'sam', 'owner'] as const) {
      const list = await offered(who);
      expect(list).not.toContain(people.dana);
      expect(list).not.toContain(people.oscar);
      expect(list).not.toContain(people.stranger);
      expect(list).not.toContain(people[who]);
    }
    // Someone who may only view gets no list at all; nor does anyone for a song they cannot see.
    expect(
      (await refusal(listMentionable(contextFor(people.viewer), ids.headlights))).publicCode,
    ).toBe('not_found');
    expect(
      (await refusal(listMentionable(contextFor(people.nina), ids.tailLights))).publicCode,
    ).toBe('not_found');
    expect(
      (await refusal(listMentionable(contextFor(people.sam), ids.foreignSong))).publicCode,
    ).toBe('not_found');
  });

  it('records a mention by id, notifies whoever it reached, and survives a rename', async () => {
    events.length = 0;
    const { commentId, unreachedMentions } = await createThread(
      contextFor(people.nina),
      ids.headlights,
      general(`${at('sam')} and ${at('alex')}: the bridge?`),
    );
    expect(unreachedMentions).toEqual([]);
    const mentioned = events.find((event) => event.event === 'comment.mentioned');
    expect(new Set(mentioned?.recipientIds)).toEqual(new Set([people.sam, people.alex]));
    expect(mentioned).toMatchObject({ targetId: ids.headlights, actorId: people.nina });

    await db.update(users).set({ displayName: 'Samantha' }).where(eq(users.id, people.sam));
    const comment = (await listThreads(contextFor(people.viewer), ids.headlights)).threads
      .flatMap((thread) => thread.comments)
      .find((candidate) => candidate.id === commentId);
    expect(comment?.body).toBe(`${at('sam')} and ${at('alex')}: the bridge?`);
    expect(comment?.mentions).toContainEqual({ id: people.sam, name: 'Samantha' });
  });

  it('never makes a mention an invitation: no row, no notice, no access — and the author is told', async () => {
    events.length = 0;
    const grantsBefore = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.workspaceId, workspaceId));
    const membershipsBefore = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
    expect(permits(await accessOf(people.oscar, ids.headlights), 'view')).toBe(false);

    const { commentId, unreachedMentions } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`${at('oscar')} ${at('dana')} ${at('stranger')} ${at('alex')} can you hear this?`),
    );
    expect(new Set(unreachedMentions)).toEqual(
      new Set([people.oscar, people.dana, people.stranger]),
    );
    const rows = await db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, commentId));
    expect(rows.map((row) => row.userId)).toEqual([people.alex]);
    const mentioned = events.filter((event) => event.event === 'comment.mentioned');
    expect(mentioned.flatMap((event) => event.recipientIds ?? [])).toEqual([people.alex]);

    // Nothing about anyone's access changed.
    expect(permits(await accessOf(people.oscar, ids.headlights), 'view')).toBe(false);
    expect(permits(await accessOf(people.dana, ids.headlights), 'view')).toBe(false);
    expect(
      await db.select().from(permissionGrants).where(eq(permissionGrants.workspaceId, workspaceId)),
    ).toEqual(grantsBefore);
    expect(
      await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.workspaceId, workspaceId)),
    ).toEqual(membershipsBefore);
    // And readers of the song are not shown who the unreachable people were.
    const listed = (await listThreads(contextFor(people.viewer), ids.headlights)).threads
      .flatMap((thread) => thread.comments)
      .find((candidate) => candidate.id === commentId);
    expect(listed?.mentions.map((person) => person.id)).toEqual([people.alex]);
  });

  it('is not a mention to name yourself, and replies mention too', async () => {
    events.length = 0;
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`Note to self ${at('sam')}`),
    );
    expect(events.some((event) => event.event === 'comment.mentioned')).toBe(false);
    const { commentId } = await reply(contextFor(people.alex), ids.headlights, threadId, {
      body: `${at('sam')} agreed`,
    });
    const rows = await db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, commentId));
    expect(rows.map((row) => row.userId)).toEqual([people.sam]);
    expect(events.find((event) => event.event === 'comment.mentioned')?.recipientIds).toEqual([
      people.sam,
    ]);
  });

  it('on edit, tells only the newly mentioned, and forgets who is no longer mentioned', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.nina),
      ids.headlights,
      general(`${at('sam')} thoughts?`),
    );
    events.length = 0;
    const edited = await editComment(contextFor(people.nina), ids.headlights, threadId, commentId, {
      body: `${at('alex')} ${at('oscar')} thoughts?`,
    });
    expect(edited.unreachedMentions).toEqual([people.oscar]);
    expect(events.find((event) => event.event === 'comment.mentioned')?.recipientIds).toEqual([
      people.alex,
    ]);
    const rows = await db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, commentId));
    expect(rows.map((row) => row.userId)).toEqual([people.alex]);
  });

  it('keeps one reaction per person per kind, counts them, and names who reacted', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general('Mix 4 is the one.'),
    );
    const heart = { reaction: 'heart' as const, on: true };
    await react(contextFor(people.alex), ids.headlights, threadId, commentId, heart);
    await react(contextFor(people.alex), ids.headlights, threadId, commentId, heart);
    await react(contextFor(people.nina), ids.headlights, threadId, commentId, heart);
    await react(contextFor(people.nina), ids.headlights, threadId, commentId, {
      reaction: 'fire',
      on: true,
    });
    const view = async (who: Person) =>
      (await listThreads(contextFor(people[who]), ids.headlights)).threads
        .flatMap((thread) => thread.comments)
        .find((candidate) => candidate.id === commentId)?.reactions;
    expect(await view('alex')).toEqual([
      { reaction: 'heart', count: 2, mine: true, people: ['alex', 'nina'] },
      { reaction: 'fire', count: 1, mine: false, people: ['nina'] },
    ]);
    await react(contextFor(people.alex), ids.headlights, threadId, commentId, {
      reaction: 'heart',
      on: false,
    });
    expect((await view('viewer'))?.[0]).toEqual({
      reaction: 'heart',
      count: 1,
      mine: false,
      people: ['nina'],
    });
  });

  it('refuses reactions from viewers, on deleted comments, and across songs and workspaces', async () => {
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`${at('alex')} listen`),
    );
    const heart = { reaction: 'heart' as const, on: true };
    const attempts: [Person, string, string, string][] = [
      ['viewer', ids.headlights, threadId, commentId],
      ['oscar', ids.headlights, threadId, commentId],
      ['sam', ids.tailLights, threadId, commentId],
      ['sam', ids.foreignSong, threadId, commentId],
      ['sam', ids.headlights, threadId, testId()],
    ];
    for (const [who, songId, thread, comment] of attempts) {
      const error = await refusal(react(contextFor(people[who]), songId, thread, comment, heart));
      expect(error.publicCode, `${who} on ${songId}`).toBe('not_found');
    }
    const unknown = await refusal(
      react(contextFor(people.sam), ids.headlights, threadId, commentId, {
        reaction: 'skull' as never,
        on: true,
      }),
    );
    expect(unknown.publicCode).toBe('validation_failed');

    // Deleting the comment takes its reactions and mentions with its words.
    await react(contextFor(people.alex), ids.headlights, threadId, commentId, heart);
    await deleteComment(contextFor(people.sam), ids.headlights, threadId, commentId);
    for (const table of [commentMentions, commentReactions]) {
      expect(await db.select().from(table).where(eq(table.commentId, commentId))).toEqual([]);
    }
    expect(
      (await refusal(react(contextFor(people.alex), ids.headlights, threadId, commentId, heart)))
        .publicCode,
    ).toBe('not_found');
  });

  it('records who resolved a thread and when, and audits it', async () => {
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general('Settle the tempo?'),
    );
    await setResolved(contextFor(people.nina), ids.headlights, threadId, { resolved: true });
    const thread = (await listThreads(contextFor(people.viewer), ids.headlights)).threads.find(
      (candidate) => candidate.id === threadId,
    );
    expect(thread?.resolvedBy).toBe('nina');
    expect(thread?.resolvedAt).toBeInstanceOf(Date);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.action, 'comment.resolved')),
      );
    expect(event).toMatchObject({ actorId: people.nina, targetId: ids.headlights });
    expect(event?.metadata).toMatchObject({ threadId });
  });
});
