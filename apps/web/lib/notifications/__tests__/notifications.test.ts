import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
  notifications,
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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createThread, reply } from '@/lib/comments/service';
import type { LibraryContext } from '@/lib/library/context';
import { updateSong } from '@/lib/library/metadata';

import { createNotifier } from '../generate';
import { listNotifications, setNotificationsRead, unreadCount } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification tests: ${reason}`);

/**
 * The notification center (task `095`) against a real database and the real resolver.
 *
 * The fixture holds the people who make each rule bite: a viewer and a commenter with full
 * membership, a collaborator who can open only "Headlights" (whose access is revoked mid-test),
 * one who can open only the other song, and a second workspace in which the owner is also a
 * member and has notifications of their own — the rows a careless read would leak across.
 */
describeWithDatabase('notification center', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let foreignWorkspace: string;
  let clock = new Date('2026-10-13T12:00:00Z');
  const people = {} as Record<
    'owner' | 'sam' | 'viewer' | 'songOnly' | 'otherSongOnly' | 'outsider',
    string
  >;
  const ids = {} as Record<'song' | 'other' | 'foreignSong' | 'songOnlyGrant', string>;

  const tick = () => {
    clock = new Date(clock.getTime() + 1_000);
    return clock;
  };

  function contextFor(userId: string, workspace = workspaceId): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      now: tick,
      notify: createNotifier(db, workspace as WorkspaceId, {
        now: tick,
        onError: (error) => {
          throw error;
        },
      }),
    };
  }

  const general = (body: string) => ({ anchor: { kind: 'general' as const }, body });
  const summaries = async (userId: string, workspace = workspaceId) =>
    (await listNotifications(contextFor(userId, workspace))).notifications.map(
      (row) => row.summary,
    );

  beforeAll(async () => {
    database = await createTestDatabase('notifications');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    const named = async (displayName: string) => {
      const user = await makeUser(db);
      await db.update(users).set({ displayName }).where(eq(users.id, user.id));
      return user.id;
    };
    await db.update(users).set({ displayName: 'Avery' }).where(eq(users.id, people.owner));
    people.sam = await named('Sam');
    people.viewer = await named('Val');
    people.songOnly = await named('Sol');
    people.otherSongOnly = await named('Otto');
    people.outsider = await named('Fay');
    await addMember(db, workspaceId, people.sam, 'commenter');
    await addMember(db, workspaceId, people.viewer, 'viewer');

    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.other = (await makeSong(db, workspaceId, project.id, 'Tail Lights')).id;
    ids.songOnlyGrant = testId();
    await withTransaction(db, async (tx) => {
      for (const [userId, songId, grantId] of [
        [people.songOnly, ids.song, ids.songOnlyGrant],
        [people.otherSongOnly, ids.other, testId()],
      ] as const) {
        await ensureScopeLimitedMembership(tx, workspaceId, userId, testId());
        await upsertGrant(tx, {
          id: grantId,
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

    // A second workspace where the owner is also a member, with a song and an outsider in it.
    const foreign = await makeTenant(db);
    foreignWorkspace = foreign.workspace.id;
    await addMember(db, foreignWorkspace, people.owner, 'editor');
    await addMember(db, foreignWorkspace, people.outsider, 'editor');
    const foreignProject = await makeProject(db, foreignWorkspace, 'Theirs');
    ids.foreignSong = (await makeSong(db, foreignWorkspace, foreignProject.id, 'Unreleased')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('tells everyone who can open the song, and never the person who acted', async () => {
    await createThread(contextFor(people.sam), ids.song, general('The kick is too loud.'));
    expect(await summaries(people.owner)).toEqual(['Sam commented on Headlights']);
    expect(await summaries(people.viewer)).toEqual(['Sam commented on Headlights']);
    expect(await summaries(people.songOnly)).toEqual(['Sam commented on Headlights']);
    expect(await summaries(people.sam)).toEqual([]);
    expect(await summaries(people.otherSongOnly)).toEqual([]);
  });

  it('groups related events into one row instead of flooding', async () => {
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.song,
      general('And the hats.'),
    );
    await reply(contextFor(people.songOnly), ids.song, threadId, { body: 'Agreed.' });
    const view = await listNotifications(contextFor(people.owner));
    expect(view.notifications).toHaveLength(1);
    expect(view.notifications[0]).toMatchObject({
      count: 3,
      summary: '3 new comments on Headlights',
    });
    expect(view.notifications[0]?.items.map((item) => item.preview)).toEqual([
      'Agreed.',
      'And the hats.',
      'The kick is too loud.',
    ]);
    expect(view.unread).toBe(1);
  });

  it('deep-links to the exact thread, and to a mention with the person’s name', async () => {
    const { threadId } = await createThread(
      contextFor(people.owner),
      ids.song,
      general(`<@${people.songOnly}> check the outro`),
    );
    const view = await listNotifications(contextFor(people.songOnly));
    const mention = view.notifications.find((row) => row.event === 'comment.mentioned');
    expect(mention?.summary).toBe('Avery mentioned you on Headlights');
    expect(mention?.href).toBe(`/songs/${ids.song}?tab=activity&thread=${threadId}`);
    expect(mention?.items[0]?.preview).toBe('@Sol check the outro');
  });

  it('announces metadata changes, and links lyric threads to the lyrics tab', async () => {
    await updateSong(contextFor(people.owner), ids.song, { title: 'Headlights (Night)' });
    expect(await summaries(people.sam)).toContain(
      'Avery changed the details of Headlights (Night)',
    );
    await db.update(songs).set({ title: 'Headlights' }).where(eq(songs.id, ids.song));

    const { threadId } = await createThread(contextFor(people.sam), ids.other, {
      anchor: { kind: 'lyric', start: {}, end: {}, quote: 'neon', scope: 'line' },
      body: 'This line.',
    });
    const otto = await listNotifications(contextFor(people.otherSongOnly));
    expect(otto.notifications[0]?.href).toBe(`/songs/${ids.other}?tab=lyrics&thread=${threadId}`);
  });

  it('filters by access when read: revoked access hides what was already written', async () => {
    expect(await unreadCount(contextFor(people.songOnly))).toBeGreaterThan(0);
    const [stored] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.recipientId, people.songOnly));
    expect(stored).toBeDefined();
    await db.delete(permissionGrants).where(eq(permissionGrants.id, ids.songOnlyGrant));
    expect(await summaries(people.songOnly)).toEqual([]);
    expect(await unreadCount(contextFor(people.songOnly))).toBe(0);
  });

  it('hides notifications about a song in the trash', async () => {
    const song = await makeSong(
      db,
      workspaceId,
      (await makeProject(db, workspaceId, 'Bin')).id,
      'Thrown Away',
    );
    await createThread(contextFor(people.sam), song.id, general('gone soon'));
    expect(await summaries(people.viewer)).toContain('Sam commented on Thrown Away');
    await db
      .update(songs)
      .set({ deletedAt: tick(), deletedBy: people.owner })
      .where(eq(songs.id, song.id));
    expect(await summaries(people.viewer)).not.toContain('Sam commented on Thrown Away');
  });

  it('keeps each workspace’s notifications to itself', async () => {
    await createThread(
      contextFor(people.outsider, foreignWorkspace),
      ids.foreignSong,
      general('theirs'),
    );
    expect(await summaries(people.owner, foreignWorkspace)).toEqual([
      'Fay commented on Unreleased',
    ]);
    expect(await summaries(people.owner)).not.toContain('Fay commented on Unreleased');
  });

  it('marks read one at a time and all at once, and only the reader’s own', async () => {
    const view = await listNotifications(contextFor(people.viewer));
    const first = view.notifications[0];
    expect(first?.read).toBe(false);
    // Another person naming this id changes nothing.
    await setNotificationsRead(contextFor(people.sam), { ids: [first?.id ?? ''] }, true);
    expect((await listNotifications(contextFor(people.viewer))).notifications[0]?.read).toBe(false);

    await setNotificationsRead(contextFor(people.viewer), { ids: [first?.id ?? ''] }, true);
    expect((await listNotifications(contextFor(people.viewer))).notifications[0]?.read).toBe(true);
    await setNotificationsRead(contextFor(people.viewer), { ids: [first?.id ?? ''] }, false);
    expect((await listNotifications(contextFor(people.viewer))).notifications[0]?.read).toBe(false);

    await setNotificationsRead(contextFor(people.viewer), { all: true }, true);
    expect(await unreadCount(contextFor(people.viewer))).toBe(0);
    // A new comment after reading starts a new unread group rather than reviving the old one.
    await createThread(contextFor(people.sam), ids.song, general('One more thing.'));
    const after = await listNotifications(contextFor(people.viewer), { unreadOnly: true });
    expect(after.notifications.map((row) => row.count)).toEqual([1]);
  });

  it('keeps the list useful: old read rows go, and nobody keeps more than the cap', async () => {
    const before = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, people.viewer),
          eq(notifications.workspaceId, workspaceId),
        ),
      );
    expect(before.length).toBeGreaterThan(1);
    await setNotificationsRead(contextFor(people.viewer), { all: true }, true);
    // Two months on, any new event prunes what was read long ago.
    clock = new Date(clock.getTime() + 60 * 24 * 60 * 60 * 1000);
    await createThread(contextFor(people.sam), ids.song, general('Back from tour.'));
    const after = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, people.viewer),
          eq(notifications.workspaceId, workspaceId),
        ),
      );
    expect(after).toHaveLength(1);
  });
});
