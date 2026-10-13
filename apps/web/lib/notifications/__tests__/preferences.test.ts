import { createAuthorizer, memberSubject, signUnsubscribe } from '@youandfriends/authz';
import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  notificationEmails,
  notificationPreferences,
  notifications,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createThread } from '@/lib/comments/service';
import type { LibraryContext } from '@/lib/library/context';

import { createNotifier } from '../generate';
import { readPreferences, unsubscribe, updatePreferences } from '../preferences';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification preference tests: ${reason}`);

const SECRET = ['preferences', 'test', 'signing', 'secret', 'long', 'enough'].join('-');

/**
 * Notification preferences and the email outbox (task `096`), against a real database. Two
 * workspaces share the person whose preferences change, so a preference that leaked across
 * workspaces — or an unsubscribe that reached past its one event — would show.
 */
describeWithDatabase('notification preferences', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let otherWorkspace: string;
  let songId: string;
  const people = {} as Record<'owner' | 'sam' | 'val', string>;

  function contextFor(userId: string, email: boolean, workspace = workspaceId): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspace as WorkspaceId,
      userId,
      notify: createNotifier(db, workspace as WorkspaceId, {
        emailAvailable: email,
        onError: (error) => {
          throw error;
        },
      }),
    };
  }

  const comment = (userId: string, body: string, email = true) =>
    createThread(contextFor(userId, email), songId, { anchor: { kind: 'general' }, body });

  const inbox = async (userId: string) =>
    db
      .select({ event: notifications.event })
      .from(notifications)
      .where(
        and(eq(notifications.recipientId, userId), eq(notifications.workspaceId, workspaceId)),
      );
  const outbox = async (userId: string) =>
    db
      .select({ event: notificationEmails.event, mode: notificationEmails.mode })
      .from(notificationEmails)
      .where(eq(notificationEmails.recipientId, userId));

  beforeAll(async () => {
    database = await createTestDatabase('preferences');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    people.sam = (await makeUser(db)).id;
    people.val = (await makeUser(db)).id;
    await addMember(db, workspaceId, people.sam, 'commenter');
    await addMember(db, workspaceId, people.val, 'viewer');
    const project = await makeProject(db, workspaceId, 'Night Drive');
    songId = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    const other = await makeTenant(db);
    otherWorkspace = other.workspace.id;
    await addMember(db, otherWorkspace, people.val, 'editor');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('starts from conservative defaults: email only for what is addressed to you', async () => {
    const view = await readPreferences(contextFor(people.val, true), { emailAvailable: true });
    const all = view.categories.flatMap((category) => category.events);
    expect(all.find((row) => row.event === 'comment.created')).toMatchObject({
      inApp: true,
      email: 'off',
    });
    expect(all.find((row) => row.event === 'comment.mentioned')).toMatchObject({
      inApp: true,
      inAppLocked: true,
      email: 'immediate',
    });
    // Without email, the page says so and nothing reads as an email choice.
    const without = await readPreferences(contextFor(people.val, false), { emailAvailable: false });
    expect(without.email.available).toBe(false);
    expect(
      without.categories.flatMap((category) => category.events).every((row) => row.email === 'off'),
    ).toBe(true);
  });

  it('stops in-app notifications for an event someone turned off, but never the required ones', async () => {
    await updatePreferences(
      contextFor(people.val, true),
      {
        preferences: [
          { event: 'comment.created', inApp: false, email: 'off' },
          { event: 'comment.mentioned', inApp: false, email: 'off' },
        ],
      },
      { emailAvailable: true },
    );
    await comment(people.sam, 'An idea for the bridge.');
    expect(await inbox(people.val)).toEqual([]);
    expect(await inbox(people.owner)).toEqual([{ event: 'comment.created' }]);
    const view = await readPreferences(contextFor(people.val, true), { emailAvailable: true });
    expect(
      view.categories
        .flatMap((category) => category.events)
        .find((row) => row.event === 'comment.mentioned')?.inApp,
    ).toBe(true);
    // The other workspace is untouched by what was chosen here.
    const elsewhere = await readPreferences(contextFor(people.val, true, otherWorkspace), {
      emailAvailable: true,
    });
    expect(
      elsewhere.categories
        .flatMap((category) => category.events)
        .find((row) => row.event === 'comment.created')?.inApp,
    ).toBe(true);
  });

  it('refuses an email choice when email is not set up, rather than storing a dead setting', async () => {
    const error = await updatePreferences(
      contextFor(people.sam, false),
      { preferences: [{ event: 'comment.created', inApp: true, email: 'digest' }] },
      { emailAvailable: false },
    ).catch((caught: unknown) => caught as { publicCode?: string });
    expect(error?.publicCode).toBe('validation_failed');
  });

  it('queues email in the chosen mode, only when email is available', async () => {
    await updatePreferences(
      contextFor(people.owner, true),
      { preferences: [{ event: 'comment.created', inApp: true, email: 'digest' }] },
      { emailAvailable: true },
    );
    await comment(people.sam, 'Second take is better.', false);
    expect(await outbox(people.owner)).toEqual([]);
    await comment(people.sam, 'Third take is best.', true);
    expect(await outbox(people.owner)).toEqual([{ event: 'comment.created', mode: 'digest' }]);
    // The mention default is immediate email.
    await comment(people.sam, `<@${people.owner}> listen`, true);
    expect(await outbox(people.owner)).toContainEqual({
      event: 'comment.mentioned',
      mode: 'immediate',
    });
  });

  it('unsubscribes one event by email, for one person, and nothing else', async () => {
    const token = signUnsubscribe(
      { userId: people.owner, workspaceId, event: 'comment.created' },
      SECRET,
    );
    expect(await unsubscribe(db, token, SECRET)).toEqual({ event: 'comment.created' });
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, people.owner));
    expect(rows.map((row) => [row.event, row.inApp, row.email])).toEqual([
      ['comment.created', true, 'off'],
    ]);
    // A token edited to another event, or signed with another key, changes nothing.
    const edited = token.replace('comment.created', 'comment.mentioned');
    expect(await unsubscribe(db, edited, SECRET)).toBeNull();
    expect(
      await unsubscribe(
        db,
        signUnsubscribe(
          { userId: people.owner, workspaceId, event: 'comment.mentioned' },
          `${SECRET}x`,
        ),
        SECRET,
      ),
    ).toBeNull();
    // Nor does a valid token for someone no longer in the workspace.
    const stranger = (await makeUser(db)).id;
    expect(
      await unsubscribe(
        db,
        signUnsubscribe({ userId: stranger, workspaceId, event: 'comment.created' }, SECRET),
        SECRET,
      ),
    ).toBeNull();
  });
});
