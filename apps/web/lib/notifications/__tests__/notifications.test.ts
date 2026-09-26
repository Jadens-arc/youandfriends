import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import {
  NOTIFICATION_EVENTS,
  type AppError,
  type UserId,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  assetVersions,
  ensureScopeLimitedMembership,
  invitations,
  notifications,
  permissionGrants,
  recordProcessingNotification,
  songs,
  upsertGrant,
  users,
  withTransaction,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeAsset,
  makeMixVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createThread, deleteComment, reply } from '@/lib/comments/service';
import { sendInvitation } from '@/lib/invitations/service';
import type { LibraryContext } from '@/lib/library/context';
import { changeMemberRole } from '@/lib/workspace/members';

import { generateNotifications, notificationSink } from '../generate';
import { listNotifications, markRead } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification tests: ${reason}`);

type Person = 'owner' | 'sam' | 'alex' | 'viewer' | 'nina' | 'dana' | 'oscar' | 'outsider';

/**
 * Notifications (task `095`) against a real database, the real resolver, and the real services
 * that raise them. Around Headlights, the fixture holds the people who must *not* hear: `dana`, an
 * editor denied on it; `oscar`, who can reach only Tail Lights; and `nina`, who can reach only
 * Headlights, through a grant that is revoked partway. `outsider` has their own workspace, and is
 * invited into this one.
 */
describeWithDatabase('notifications', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let outsiderWorkspace: string;
  const people = {} as Record<Person, string>;
  const ids = {} as Record<'project' | 'headlights' | 'tailLights' | 'ninaGrant', string>;

  function contextFor(userId: string, workspace = workspaceId) {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      notify: notificationSink(db, workspace),
    } satisfies LibraryContext;
  }

  const list = (who: Person, workspace = workspaceId) =>
    listNotifications(contextFor(people[who], workspace));

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  async function named(displayName: string) {
    const user = await makeUser(db);
    await db.update(users).set({ displayName }).where(eq(users.id, user.id));
    return user.id;
  }

  async function songGrant(userId: string, songId: string) {
    const grantId = testId();
    await withTransaction(db, async (tx) => {
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
    });
    const [grant] = await db
      .select({ id: permissionGrants.id })
      .from(permissionGrants)
      .where(and(eq(permissionGrants.subjectId, userId), eq(permissionGrants.scopeId, songId)));
    return grant?.id ?? grantId;
  }

  /** Everyone's notifications gone, so each case counts only its own. */
  async function clear() {
    await db.delete(notifications);
  }

  const general = (body: string) => ({ anchor: { kind: 'general' as const }, body });

  beforeAll(async () => {
    database = await createTestDatabase('notifications');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    people.owner = tenant.user.id;
    await db.update(users).set({ displayName: 'Owen' }).where(eq(users.id, people.owner));
    for (const [person, role] of [
      ['sam', 'commenter'],
      ['alex', 'commenter'],
      ['viewer', 'viewer'],
      ['dana', 'editor'],
    ] as const) {
      people[person] = await named(person === 'sam' ? 'Sam' : person === 'alex' ? 'Alex' : person);
      await addMember(db, workspaceId, people[person], role);
    }
    ids.project = (await makeProject(db, workspaceId, 'Night Drive')).id;
    ids.headlights = (await makeSong(db, workspaceId, ids.project, 'Headlights')).id;
    ids.tailLights = (await makeSong(db, workspaceId, ids.project, 'Tail Lights')).id;
    people.nina = await named('nina');
    ids.ninaGrant = await songGrant(people.nina, ids.headlights);
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
    const outside = await makeTenant(db);
    people.outsider = outside.user.id;
    outsiderWorkspace = outside.workspace.id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('tells everyone who can see the song — never the actor, never anyone who cannot', async () => {
    await clear();
    const { commentId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general('The bridge drags.'),
    );
    const recipients = await db.select({ id: notifications.recipientId }).from(notifications);
    expect(new Set(recipients.map((row) => row.id))).toEqual(
      new Set([people.owner, people.alex, people.viewer, people.nina]),
    );
    const [group] = (await list('viewer')).groups;
    expect(group).toMatchObject({
      summary: 'Sam commented on Headlights',
      preview: 'The bridge drags.',
      href: `/songs/${ids.headlights}?tab=activity#comment-${commentId}`,
      unread: true,
    });
    expect((await list('sam')).groups).toEqual([]);
    expect((await list('dana')).groups).toEqual([]);
    expect((await list('oscar')).groups).toEqual([]);
  });

  it('never writes a notification to its own actor, even if asked to', async () => {
    const written = await generateNotifications(db, workspaceId, {
      event: 'comment.created',
      targetType: 'song',
      targetId: ids.headlights,
      actorId: people.sam,
      recipientIds: [people.sam, people.alex],
    });
    expect(written).toEqual([people.alex]);
    await expect(
      db.insert(notifications).values({
        id: testId(),
        workspaceId,
        recipientId: people.sam,
        actorId: people.sam,
        event: 'comment.created',
        targetType: 'song',
        targetId: ids.headlights,
        groupKey: 'x',
      }),
    ).rejects.toThrow();
  });

  it('tells a mentioned person once, as a mention, and a reply only the conversation', async () => {
    await clear();
    const { threadId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`<@${people.alex}> can you redo the bridge?`),
    );
    const alex = (await list('alex')).groups;
    expect(alex.map((group) => group.summary)).toEqual(['Sam mentioned you on Headlights']);
    expect(alex[0]?.preview).toBe('@Alex can you redo the bridge?');

    await clear();
    await reply(contextFor(people.alex), ids.headlights, threadId, { body: 'On it.' });
    // Sam wrote in the thread; Owen, the viewer, and Nina did not.
    expect((await list('sam')).groups.map((group) => group.summary)).toEqual([
      'Alex replied on Headlights',
    ]);
    for (const who of ['owner', 'viewer', 'nina'] as const) {
      expect((await list(who)).groups, who).toEqual([]);
    }
  });

  it('folds many comments on a song into one entry, and keeps mentions apart', async () => {
    await clear();
    for (let index = 0; index < 4; index += 1) {
      await createThread(contextFor(people.sam), ids.headlights, general(`Note ${index}`));
    }
    await createThread(
      contextFor(people.alex),
      ids.headlights,
      general(`<@${people.owner}> the last one`),
    );
    await createThread(contextFor(people.alex), ids.headlights, general('And another'));
    const view = await list('owner');
    expect(view.groups.map((group) => [group.summary, group.count])).toEqual([
      ['Alex and Sam left 5 comments on Headlights', 5],
      ['Alex mentioned you on Headlights', 1],
    ]);
    expect(view.unread).toBe(2);
    expect(view.groups[0]?.items).toHaveLength(5);
  });

  it('marks read one entry or all — only ever one’s own', async () => {
    await clear();
    await createThread(contextFor(people.sam), ids.headlights, general('One'));
    await createThread(contextFor(people.sam), ids.tailLights, general('Two'));
    const [first] = (await list('owner')).groups;
    const theirs = first?.items.map((item) => item.id) ?? [];
    // Someone else's ids mark nothing.
    expect(await markRead(contextFor(people.alex), { ids: theirs })).toBe(0);
    expect(await markRead(contextFor(people.owner), { ids: theirs })).toBe(1);
    const after = await list('owner');
    expect(after.unread).toBe(1);
    expect(after.groups.find((group) => group.key === first?.key)?.unread).toBe(false);
    expect(
      (await listNotifications(contextFor(people.owner), { unreadOnly: true })).groups,
    ).toHaveLength(1);
    await markRead(contextFor(people.owner), { all: true });
    expect((await list('owner')).unread).toBe(0);
    expect((await list('alex')).unread).toBeGreaterThan(0);
    const bad = await refusal(markRead(contextFor(people.owner), { ids: ['nope'] }));
    expect(bad.publicCode).toBe('validation_failed');
  });

  it('hides a notification once its reader cannot see the song — revoked, or trashed', async () => {
    await clear();
    await createThread(contextFor(people.sam), ids.headlights, general('Still there?'));
    expect((await list('nina')).groups).toHaveLength(1);
    // Nina's only way in is revoked. The row stays; the list no longer shows it.
    await db.delete(permissionGrants).where(eq(permissionGrants.id, ids.ninaGrant));
    expect((await list('nina')).groups).toEqual([]);
    expect((await list('nina')).unread).toBe(0);
    expect(
      await db.select().from(notifications).where(eq(notifications.recipientId, people.nina)),
    ).toHaveLength(1);
    ids.ninaGrant = await songGrant(people.nina, ids.headlights);
    expect((await list('nina')).groups).toHaveLength(1);

    const trashed = await makeSong(db, workspaceId, ids.project, 'Thrown Away');
    await createThread(contextFor(people.sam), trashed.id, general('Soon gone'));
    expect((await list('owner')).groups.some((group) => group.summary.includes('Thrown'))).toBe(
      true,
    );
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, trashed.id));
    expect((await list('owner')).groups.some((group) => group.summary.includes('Thrown'))).toBe(
      false,
    );
  });

  it('takes a deleted comment’s words out of its notifications, and its mentions with them', async () => {
    await clear();
    const { threadId, commentId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`<@${people.alex}> secret plans`),
    );
    await deleteComment(contextFor(people.sam), ids.headlights, threadId, commentId);
    expect((await list('alex')).groups).toEqual([]);
    const [owner] = (await list('owner')).groups;
    expect(owner?.preview).toBe('This comment was deleted.');
    expect(JSON.stringify(await list('owner'))).not.toContain('secret');
  });

  it('keeps the list useful: old ones go, read ones sooner', async () => {
    await clear();
    const day = 24 * 60 * 60 * 1000;
    const row = (createdDaysAgo: number, readDaysAgo: number | null) => ({
      id: testId(),
      workspaceId,
      recipientId: people.owner,
      actorId: people.sam,
      event: 'metadata.changed',
      targetType: 'song' as const,
      targetId: ids.headlights,
      groupKey: testId(),
      createdAt: new Date(Date.now() - createdDaysAgo * day),
      readAt: readDaysAgo === null ? null : new Date(Date.now() - readDaysAgo * day),
    });
    const kept = [row(5, null), row(80, null), row(40, 10)];
    const dropped = [row(91, null), row(45, 31)];
    await db.insert(notifications).values([...kept, ...dropped]);
    await list('owner');
    const left = await db.select({ id: notifications.id }).from(notifications);
    expect(new Set(left.map((entry) => entry.id))).toEqual(new Set(kept.map((entry) => entry.id)));
  });

  it('says something true, and links somewhere real, for every kind of event', async () => {
    await clear();
    const asset = await makeAsset(db, workspaceId, { songId: ids.headlights });
    const object = await makeStorageObject(db, workspaceId);
    // Uploaded by Owen, who is waiting to hear it processed. Versions are written once.
    const [assetVersion] = await db
      .insert(assetVersions)
      .values({
        id: testId(),
        workspaceId,
        assetId: asset.id,
        storageObjectId: object.id,
        versionNumber: 1,
        uploadedBy: people.owner,
      })
      .returning();
    if (assetVersion === undefined) throw new Error('no version');
    const mix = await makeMixVersion(db, workspaceId, ids.headlights, assetVersion.id, 3);
    const raise = (event: (typeof NOTIFICATION_EVENTS)[number], extra = {}) =>
      generateNotifications(db, workspaceId, {
        event,
        targetType: 'song',
        targetId: ids.headlights,
        actorId: people.sam,
        recipientIds: [people.owner],
        ...extra,
      });
    await raise('version.created', {
      detail: { mixVersionId: mix.id, assetVersionId: assetVersion.id },
    });
    await raise('lyrics.changed');
    await generateNotifications(db, workspaceId, {
      event: 'metadata.changed',
      targetType: 'project',
      targetId: ids.project,
      actorId: people.sam,
      recipientIds: [people.owner],
    });
    const { commentId } = await createThread(
      contextFor(people.sam),
      ids.headlights,
      general(`<@${people.owner}> hi`),
    );
    expect(commentId).toBeDefined();
    const { threadId } = await createThread(
      contextFor(people.owner),
      ids.tailLights,
      general('Thoughts?'),
    );
    await reply(contextFor(people.sam), ids.tailLights, threadId, { body: 'Yes' });
    await raise('voice_note.created');
    await changeMemberRole(
      {
        db,
        subject: memberSubject(people.owner as UserId),
        workspaceId: workspaceId as WorkspaceId,
        actingUserId: people.owner,
        notify: notificationSink(db, workspaceId),
      },
      people.alex,
      'editor',
    );
    for (const event of ['version.processed', 'version.processing_failed'] as const) {
      expect(
        await recordProcessingNotification(db, {
          workspaceId,
          assetVersionId: assetVersion.id,
          event,
          id: testId(),
        }),
      ).toBe(true);
    }

    const summaries = (await list('owner')).groups.flatMap((group) =>
      group.items.map((item) => [item.event, item.summary, item.href]),
    );
    const byEvent = new Map(summaries.map(([event, summary, href]) => [event, { summary, href }]));
    expect(byEvent.get('version.created')).toEqual({
      summary: 'Sam uploaded version 3 of Headlights',
      href: `/songs/${ids.headlights}?version=${mix.id}`,
    });
    expect(byEvent.get('lyrics.changed')).toEqual({
      summary: 'Sam changed the lyrics of Headlights',
      href: `/songs/${ids.headlights}?tab=lyrics`,
    });
    expect(byEvent.get('metadata.changed')).toEqual({
      summary: 'Sam edited the details of Night Drive',
      href: `/projects/${ids.project}`,
    });
    expect(byEvent.get('comment.mentioned')?.summary).toBe('Sam mentioned you on Headlights');
    expect(byEvent.get('comment.replied')?.summary).toBe('Sam replied on Tail Lights');
    expect(byEvent.get('voice_note.created')?.summary).toBe('Sam left a voice note on Headlights');
    expect(byEvent.get('version.processed')?.summary).toBe(
      'Your upload to Headlights is ready to play',
    );
    expect(byEvent.get('version.processing_failed')?.summary).toBe(
      'Your upload to Headlights couldn’t be processed',
    );
    // Alex's role changed; Owen, who changed it, hears nothing of it.
    expect(byEvent.has('access.changed')).toBe(false);
    const alex = (await list('alex')).groups.find((group) => group.event === 'access.changed');
    expect(alex).toMatchObject({ href: '/' });
    expect(alex?.summary).toMatch(/^Owen changed your access in /);
    // `comment.created` is covered above; `invitation.received` below.
    const covered = new Set([
      ...byEvent.keys(),
      'access.changed',
      'comment.created',
      'invitation.received',
    ]);
    expect(NOTIFICATION_EVENTS.filter((event) => !covered.has(event))).toEqual([]);
  });

  it('tells someone with an account they were invited — no token, and gone once it is not pending', async () => {
    await clear();
    // Inviting takes `can_invite`, which the factory's owner does not carry.
    await db
      .update(workspaceMemberships)
      .set({ canInvite: true })
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, people.owner),
        ),
      );
    const [outsider] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, people.outsider));
    const { invitationId } = await sendInvitation(contextFor(people.owner), {
      email: outsider?.email.toUpperCase(),
      scopeType: 'song',
      scopeId: ids.headlights,
      role: 'viewer',
      canDownload: false,
      canInvite: false,
    });
    // Seen from their own workspace — they are not a member of this one yet.
    const [group] = (await list('outsider', outsiderWorkspace)).groups;
    expect(group).toMatchObject({ href: null, unread: true });
    expect(group?.summary).toMatch(/^Owen invited you to /);
    expect(JSON.stringify(group)).not.toMatch(/invite_|token/i);
    await db.update(invitations).set({ state: 'revoked' }).where(eq(invitations.id, invitationId));
    expect((await list('outsider', outsiderWorkspace)).groups).toEqual([]);
  });
});
