import { verifyUnsubscribe } from '@youandfriends/authz';
import type { EmailConfig } from '@youandfriends/config';
import { newUlid } from '@youandfriends/contracts';
import {
  comments,
  commentThreads,
  notifications,
  notificationSettings,
  permissionGrants,
  songs,
  users,
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
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DIGEST_LINES,
  resendSender,
  sendDigests,
  sendNotificationEmails,
  type EmailMessage,
} from '../email';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification email tests: ${reason}`);

const config: EmailConfig = {
  apiKey: ['re', 'EXAMPLENOTAREALKEY'].join('_'),
  from: 'studio@youandfriends.org',
  linkSecret: ['link', 'test', 'EXAMPLENOTAREALSECRETVALUE00'].join('_'),
  appUrl: 'https://app.test',
};

/**
 * Notification email (task `096`) against a real database, with a recording sender in place of
 * Resend's API. The fixture: a reader who can see Headlights, one whose access is revoked between
 * the event and the email, a song trashed in between, and a comment whose words must not travel.
 */
describeWithDatabase('notification email', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<'owner' | 'reader' | 'revoked', string>;
  const ids = {} as Record<'headlights' | 'trashed' | 'comment' | 'revokedGrant', string>;
  let sent: EmailMessage[] = [];
  const send = async (message: EmailMessage) => {
    sent.push(message);
  };
  const deps = () => ({ db, config, send });

  async function pending(recipient: string, targetId: string, extra: Record<string, unknown> = {}) {
    const id = testId();
    await db.insert(notifications).values({
      id,
      workspaceId,
      recipientId: recipient,
      actorId: people.owner,
      event: 'comment.mentioned',
      targetType: 'song',
      targetId,
      groupKey: `comment.mentioned:${id}`,
      detail: { commentId: ids.comment },
      emailStatus: 'pending',
      ...extra,
    });
    return id;
  }

  const status = async (id: string) =>
    (await db.select().from(notifications).where(eq(notifications.id, id)))[0]?.emailStatus;

  beforeAll(async () => {
    database = await createTestDatabase('notification_email');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id;
    people.owner = tenant.user.id;
    await db.update(users).set({ displayName: 'Owen' }).where(eq(users.id, people.owner));
    people.reader = (await makeUser(db)).id;
    await addMember(db, workspaceId, people.reader, 'commenter');
    people.revoked = (await makeUser(db)).id;
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.headlights = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.trashed = (await makeSong(db, workspaceId, project.id, 'Thrown Away')).id;
    await addMember(db, workspaceId, people.revoked, 'viewer');
    const threadId = testId();
    ids.comment = testId();
    await db
      .insert(commentThreads)
      .values({ id: threadId, workspaceId, songId: ids.headlights, anchorKind: 'general' });
    await db.insert(comments).values({
      id: ids.comment,
      workspaceId,
      threadId,
      authorId: people.owner,
      body: 'The unreleased second verse goes: secret words',
    });
  }, 60_000);

  beforeEach(async () => {
    sent = [];
    await db.delete(notifications);
    await db.delete(notificationSettings);
  });

  afterAll(async () => {
    await database?.teardown();
  });

  it('sends one short email: what happened and where — never the words — and a way to stop it', async () => {
    const id = await pending(people.reader, ids.headlights);
    expect(await sendNotificationEmails(deps(), [id])).toEqual({ sent: 1, skipped: 0, waiting: 0 });
    const [email] = sent;
    expect(email?.subject).toBe('Owen mentioned you on Headlights');
    expect(email?.text).toContain(
      `https://app.test/songs/${ids.headlights}?tab=activity#comment-${ids.comment}`,
    );
    expect(`${email?.text}${email?.html}`).not.toContain('secret words');
    expect(email?.idempotencyKey).toBe(`notification:${id}`);
    const header = email?.headers['List-Unsubscribe'] ?? '';
    expect(email?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const token = decodeURIComponent(/[?&]t=([^>]+)/.exec(header)?.[1] ?? '');
    // The link can stop exactly this kind of email, for exactly this person.
    expect(verifyUnsubscribe(config.linkSecret, token)).toEqual({
      userId: people.reader,
      scope: 'comment.mentioned',
    });
    expect(await status(id)).toBe('sent');
    // A retried job sends nothing twice.
    await sendNotificationEmails(deps(), [id]);
    expect(sent).toHaveLength(1);
  });

  it('checks again at send time: revoked access, a trashed song, or email switched off means no email', async () => {
    const revoked = await pending(people.revoked, ids.headlights);
    const trashed = await pending(people.reader, ids.trashed, { detail: {} });
    const unwanted = await pending(people.reader, ids.headlights, { event: 'comment.created' });
    // Between the event and the send: access revoked, the song trashed.
    const [grant] = await db
      .insert(permissionGrants)
      .values({
        id: testId(),
        workspaceId,
        scopeType: 'song',
        scopeId: ids.headlights,
        subjectKind: 'member',
        subjectId: people.revoked,
        role: null,
        isDeny: true,
        createdByUserId: people.owner,
      })
      .returning();
    ids.revokedGrant = grant?.id ?? '';
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, ids.trashed));
    const outcome = await sendNotificationEmails(deps(), [revoked, trashed, unwanted]);
    expect(outcome).toEqual({ sent: 0, skipped: 3, waiting: 0 });
    expect(sent).toEqual([]);
    for (const id of [revoked, trashed, unwanted]) expect(await status(id)).toBe('skipped');
    await db.delete(permissionGrants).where(eq(permissionGrants.id, ids.revokedGrant));
    await db
      .update(songs)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(songs.id, ids.trashed));
  });

  it('sends nothing and marks nothing sent when email is not configured', async () => {
    const id = await pending(people.reader, ids.headlights);
    expect(await sendNotificationEmails({ ...deps(), config: null }, [id])).toEqual({
      sent: 0,
      skipped: 0,
      waiting: 1,
    });
    expect(await sendDigests({ ...deps(), config: null })).toMatchObject({ sent: 0 });
    expect(sent).toEqual([]);
    expect(await status(id)).toBe('pending');
  });

  it('gathers a daily reader’s email into one digest, leaving out what they can no longer see', async () => {
    await db.insert(notificationSettings).values({ userId: people.reader, emailMode: 'daily' });
    const kept = [
      await pending(people.reader, ids.headlights),
      await pending(people.reader, ids.headlights, {
        event: 'access.changed',
        targetType: 'workspace',
        targetId: workspaceId,
        detail: {},
      }),
    ];
    const gone = await pending(people.reader, ids.trashed, { detail: {} });
    await db
      .update(songs)
      .set({ deletedAt: new Date(), deletedBy: people.owner })
      .where(eq(songs.id, ids.trashed));
    // Immediate delivery leaves a daily reader's email for the digest.
    expect(await sendNotificationEmails(deps(), kept)).toMatchObject({ sent: 0, waiting: 2 });
    const outcome = await sendDigests(deps());
    expect(outcome).toMatchObject({ sent: 2, skipped: 1 });
    expect(sent).toHaveLength(1);
    const [digest] = sent;
    expect(digest?.subject).toBe('2 updates on You & Friends');
    expect(digest?.text).toContain('Owen mentioned you on Headlights');
    expect(digest?.text).not.toContain('Thrown Away');
    const token = decodeURIComponent(
      /[?&]t=([^>]+)/.exec(digest?.headers['List-Unsubscribe'] ?? '')?.[1] ?? '',
    );
    expect(verifyUnsubscribe(config.linkSecret, token)?.scope).toBe('all');
    expect(await status(gone)).toBe('skipped');
    const [settings] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, people.reader));
    expect(settings?.lastDigestAt).toBeInstanceOf(Date);
    await db
      .update(songs)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(songs.id, ids.trashed));
  });

  it('keeps a long digest short, and sweeps up immediate email the queue dropped', async () => {
    await db.insert(notificationSettings).values({ userId: people.reader, emailMode: 'daily' });
    for (let index = 0; index < DIGEST_LINES + 3; index += 1) {
      await pending(people.reader, ids.headlights);
    }
    const stranded = await pending(people.revoked, ids.headlights, {
      createdAt: new Date(Date.now() - 60 * 60_000),
    });
    await sendDigests(deps());
    const digest = sent.find((message) => message.subject.includes('updates'));
    expect(digest?.text).toContain('And 3 more in your notifications.');
    expect(sent.some((message) => message.idempotencyKey === `notification:${stranded}`)).toBe(
      true,
    );
    const left = await db
      .select()
      .from(notifications)
      .where(inArray(notifications.emailStatus, ['pending']));
    expect(left).toEqual([]);
  });
});

describe('the Resend sender (task 096)', () => {
  it('posts one email with its key, and reports a refusal by status only', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const ok = resendSender(config, (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    await ok({
      to: 'reader@example.test',
      subject: 'S',
      text: 'T',
      html: '<p>T</p>',
      headers: { 'List-Unsubscribe': '<https://app.test/x>' },
      idempotencyKey: `notification:${newUlid()}`,
    });
    expect(requests[0]?.url).toBe('https://api.resend.com/emails');
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${config.apiKey}`);
    expect(headers['idempotency-key']).toMatch(/^notification:/);
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      from: config.from,
      to: ['reader@example.test'],
    });
    const refused = resendSender(
      config,
      (async () =>
        new Response('{"message":"reader@example.test is invalid"}', {
          status: 422,
        })) as unknown as typeof fetch,
    );
    await expect(
      refused({
        to: 'reader@example.test',
        subject: 'S',
        text: 'T',
        html: 'T',
        headers: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow('Resend refused the email: HTTP 422');
  });
});
