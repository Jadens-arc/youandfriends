import { signUnsubscribe } from '@youandfriends/authz';
import { newUlid, type AppError } from '@youandfriends/contracts';
import {
  notificationPreferences,
  notifications,
  recentNotificationsFor,
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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateNotifications } from '../generate';
import { readPreferences, unsubscribe, updatePreferences } from '../preferences';

vi.mock('server-only', () => ({}));

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification preference tests: ${reason}`);

const secret = ['prefs', 'test', 'EXAMPLENOTAREALSECRETVALUE00'].join('_');
const on = { available: true } as const;
const off = { available: false } as const;

/**
 * Preferences (task `096`) against a real database, and generation honouring them. Two people
 * with preferences, so "only one's own" and "only the one event" have someone else to protect.
 */
describeWithDatabase('notification preferences', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  let songId: string;
  const people = {} as Record<'owner' | 'sam' | 'alex', string>;

  async function refusal(promise: Promise<unknown>): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      return error as AppError;
    }
    throw new Error('expected a refusal');
  }

  const me = (userId: string) => ({ db, userId });

  beforeAll(async () => {
    database = await createTestDatabase('notification_preferences');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    people.owner = tenant.user.id;
    for (const person of ['sam', 'alex'] as const) {
      people[person] = (await makeUser(db)).id;
      await addMember(db, workspaceId, people[person], 'commenter');
    }
    const project = await makeProject(db, workspaceId, 'Night Drive');
    songId = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('starts conservative: everything in the app, email only for what is addressed to you', async () => {
    const view = await readPreferences(me(people.sam), on);
    expect(view.preferences['comment.created']).toEqual({ in_app: true, email: false });
    expect(view.preferences['comment.mentioned']).toEqual({ in_app: true, email: true });
    expect(view.preferences['access.changed']).toEqual({ in_app: true, email: true });
    expect(view.emailMode).toBe('immediate');
  });

  it('saves one person’s choices, per event and channel, without touching anyone else’s', async () => {
    await updatePreferences(
      me(people.sam),
      {
        preferences: [
          { event: 'comment.created', channel: 'in_app', enabled: false },
          { event: 'comment.created', channel: 'email', enabled: true },
        ],
        emailMode: 'daily',
      },
      on,
    );
    const sam = await readPreferences(me(people.sam), on);
    expect(sam.preferences['comment.created']).toEqual({ in_app: false, email: true });
    expect(sam.emailMode).toBe('daily');
    const alex = await readPreferences(me(people.alex), on);
    expect(alex.preferences['comment.created']).toEqual({ in_app: true, email: false });
    expect(alex.emailMode).toBe('immediate');
  });

  it('keeps the required events in the app, whatever is asked', async () => {
    const error = await refusal(
      updatePreferences(
        me(people.alex),
        { preferences: [{ event: 'comment.mentioned', channel: 'in_app', enabled: false }] },
        on,
      ),
    );
    expect(error.publicCode).toBe('validation_failed');
    // Even a row written behind the service's back does not switch them off.
    await db.insert(notificationPreferences).values({
      id: newUlid(),
      userId: people.alex,
      event: 'access.changed',
      channel: 'in_app',
      enabled: false,
    });
    expect((await readPreferences(me(people.alex), on)).preferences['access.changed'].in_app).toBe(
      true,
    );
  });

  it('refuses to save email choices when email is not available — no switch that does nothing', async () => {
    for (const change of [
      {
        preferences: [
          { event: 'comment.created' as const, channel: 'email' as const, enabled: true },
        ],
      },
      { emailMode: 'daily' as const },
    ]) {
      expect((await refusal(updatePreferences(me(people.alex), change, off))).publicCode).toBe(
        'validation_failed',
      );
    }
    expect((await readPreferences(me(people.alex), off)).email).toEqual({ available: false });
    // Switching email off is always allowed.
    await updatePreferences(
      me(people.alex),
      { preferences: [{ event: 'comment.mentioned', channel: 'email', enabled: false }] },
      off,
    );
  });

  it('unsubscribes exactly what the link names, for exactly whom — and nothing for a forgery', async () => {
    const alexBefore = await readPreferences(me(people.alex), on);
    const token = signUnsubscribe(secret, { userId: people.owner, scope: 'comment.mentioned' });
    expect(await unsubscribe(db, secret, token)).toEqual({ scope: 'comment.mentioned' });
    const owner = await readPreferences(me(people.owner), on);
    expect(owner.preferences['comment.mentioned']).toEqual({ in_app: true, email: false });
    expect(owner.preferences['access.changed'].email).toBe(true);
    expect(await readPreferences(me(people.alex), on)).toEqual(alexBefore);

    expect(await unsubscribe(db, secret, `${token}x`)).toBeNull();
    expect(await unsubscribe(db, 'another-secret-another-secret-00', token)).toBeNull();

    await unsubscribe(db, secret, signUnsubscribe(secret, { userId: people.owner, scope: 'all' }));
    const all = await readPreferences(me(people.owner), on);
    expect(Object.values(all.preferences).every((choice) => !choice.email)).toBe(true);
    expect(Object.values(all.preferences).every((choice) => choice.in_app)).toBe(true);
  });

  it('writes what each reader chose: in the app, by email, both, or nothing', async () => {
    await db.delete(notifications);
    // Sam: comments by email only, daily. Alex: defaults (in the app, no email). Owen: acts.
    const dispatched: string[][] = [];
    const email = {
      available: true,
      dispatch: async (ids: readonly string[]) => {
        dispatched.push([...ids]);
      },
    };
    await updatePreferences(
      me(people.alex),
      { preferences: [{ event: 'lyrics.changed', channel: 'in_app', enabled: false }] },
      on,
    );
    await generateNotifications(
      db,
      workspaceId,
      { event: 'comment.created', targetType: 'song', targetId: songId, actorId: people.owner },
      { email },
    );
    await generateNotifications(
      db,
      workspaceId,
      { event: 'lyrics.changed', targetType: 'song', targetId: songId, actorId: people.owner },
      { email },
    );
    const rows = await db.select().from(notifications);
    const of = (who: 'sam' | 'alex', event: string) =>
      rows.find((row) => row.recipientId === people[who] && row.event === event);
    expect(of('sam', 'comment.created')).toMatchObject({ inApp: false, emailStatus: 'pending' });
    expect(of('alex', 'comment.created')).toMatchObject({ inApp: true, emailStatus: null });
    // Alex wants neither for lyrics: no row at all.
    expect(of('alex', 'lyrics.changed')).toBeUndefined();
    // Sam takes a daily digest: nothing is handed over now.
    expect(dispatched.flat()).not.toContain(of('sam', 'comment.created')?.id);
    // Switched off in the app: kept only to be emailed, never listed.
    expect(
      (await recentNotificationsFor(db, workspaceId, people.sam)).map((row) => row.event),
    ).not.toContain('comment.created');

    // Immediate email is handed over at once; unavailable email marks nothing.
    await db.delete(notifications);
    await updatePreferences(
      me(people.alex),
      { preferences: [{ event: 'comment.created', channel: 'email', enabled: true }] },
      on,
    );
    await generateNotifications(
      db,
      workspaceId,
      { event: 'comment.created', targetType: 'song', targetId: songId, actorId: people.owner },
      { email },
    );
    const alexRow = (await db.select().from(notifications)).find(
      (row) => row.recipientId === people.alex,
    );
    expect(alexRow?.emailStatus).toBe('pending');
    expect(dispatched.flat()).toContain(alexRow?.id);

    await db.delete(notifications);
    await generateNotifications(
      db,
      workspaceId,
      { event: 'comment.created', targetType: 'song', targetId: songId, actorId: people.owner },
      { email: { ...email, available: false } },
    );
    const unavailable = await db.select().from(notifications);
    expect(unavailable.every((row) => row.emailStatus === null)).toBe(true);
    // Sam wants comments by email only; with no email, there is nothing to write for Sam.
    expect(unavailable.some((row) => row.recipientId === people.sam)).toBe(false);
    expect(
      await db.select().from(notifications).where(eq(notifications.recipientId, people.alex)),
    ).toHaveLength(1);
  });
});
