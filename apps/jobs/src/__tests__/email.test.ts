import { verifyUnsubscribe } from '@youandfriends/authz';
import {
  notificationEmails,
  permissionGrants,
  queueNotificationEmails,
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
import { ensureScopeLimitedMembership, upsertGrant, withTransaction } from '@youandfriends/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deliverQueuedEmails, MAX_ATTEMPTS, type EmailMessage } from '../email';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING notification email tests: ${reason}`);

const SECRET = ['email', 'test', 'signing', 'secret', 'long', 'enough'].join('-');

/**
 * Sending notification emails (task `096`) against a real database: the access re-check at send
 * time, minimal content, signed per-event unsubscribe links, retries, and digest grouping. The
 * fixture has a collaborator whose only access is a song grant, revoked between queueing and
 * sending — the case the re-check exists for.
 */
describeWithDatabase('notification emails', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: string;
  const people = {} as Record<'owner' | 'sam' | 'narrow', string>;
  const ids = {} as Record<'song' | 'secret' | 'grant', string>;
  let outcome = true;
  const sent: EmailMessage[] = [];

  const deps = () => ({
    db,
    from: 'notify@example.test',
    appUrl: 'https://app.example.test',
    signingSecret: SECRET,
    send: async (message: EmailMessage) => {
      sent.push(message);
      return { ok: outcome };
    },
  });

  const queue = (
    recipientId: string,
    targetId: string,
    mode: 'immediate' | 'digest',
    event = 'comment.mentioned',
  ) =>
    queueNotificationEmails(
      db,
      [
        {
          workspaceId,
          recipientId,
          event,
          targetType: 'song',
          targetId,
          actorId: people.sam,
          link: { threadId: 'T1', tab: 'activity' },
          mode,
        },
      ],
      testId,
      new Date(),
    );

  const statusOf = async (recipientId: string) =>
    (
      await db
        .select({ status: notificationEmails.status })
        .from(notificationEmails)
        .where(eq(notificationEmails.recipientId, recipientId))
    ).map((row) => row.status);

  beforeAll(async () => {
    database = await createTestDatabase('notification-emails');
    db = database.db;
    const tenant = await makeTenant(db);
    people.owner = tenant.user.id;
    workspaceId = tenant.workspace.id;
    people.sam = (await makeUser(db)).id;
    people.narrow = (await makeUser(db)).id;
    await addMember(db, workspaceId, people.sam, 'commenter');
    const project = await makeProject(db, workspaceId, 'Night Drive');
    ids.song = (await makeSong(db, workspaceId, project.id, 'Headlights')).id;
    ids.secret = (await makeSong(db, workspaceId, project.id, 'Untitled Secret')).id;
    ids.grant = testId();
    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspaceId, people.narrow, testId());
      await upsertGrant(tx, {
        id: ids.grant,
        workspaceId,
        scopeType: 'song',
        scopeId: ids.secret,
        subjectKind: 'member',
        subjectId: people.narrow,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: people.owner,
      });
    });
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('sends a minimal email with a deep link and a signed one-event unsubscribe', async () => {
    sent.length = 0;
    await queue(people.owner, ids.song, 'immediate');
    const report = await deliverQueuedEmails(deps(), 'immediate');
    expect(report).toMatchObject({ sent: 1, dropped: 0 });
    const [message] = sent;
    expect(message?.subject).toMatch(/mentioned you on Headlights$/);
    expect(message?.text).toContain(
      `https://app.example.test/songs/${ids.song}?tab=activity&thread=T1`,
    );
    const unsubscribe = /unsubscribe\?token=([^\s]+)/.exec(message?.text ?? '')?.[1] ?? '';
    expect(verifyUnsubscribe(decodeURIComponent(unsubscribe), SECRET)).toEqual({
      userId: people.owner,
      workspaceId,
      event: 'comment.mentioned',
    });
    expect(message?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(await statusOf(people.owner)).toEqual(['sent']);
  });

  it('drops what the recipient can no longer open, without naming it', async () => {
    sent.length = 0;
    await queue(people.narrow, ids.secret, 'immediate');
    await db.delete(permissionGrants).where(eq(permissionGrants.id, ids.grant));
    const report = await deliverQueuedEmails(deps(), 'immediate');
    expect(report).toMatchObject({ sent: 0, dropped: 1 });
    expect(sent).toEqual([]);
    expect(await statusOf(people.narrow)).toEqual(['dropped']);
  });

  it('retries a failed send, then gives up and says so', async () => {
    sent.length = 0;
    outcome = false;
    await queue(people.sam, ids.song, 'immediate');
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await deliverQueuedEmails(deps(), 'immediate')).toMatchObject({ retried: 1 });
      expect(await statusOf(people.sam)).toEqual(['queued']);
    }
    expect(await deliverQueuedEmails(deps(), 'immediate')).toMatchObject({ failed: 1 });
    expect(await statusOf(people.sam)).toEqual(['failed']);
    outcome = true;
  });

  it('groups a day’s events into one digest per person, and leaves immediate ones alone', async () => {
    sent.length = 0;
    await queue(people.owner, ids.song, 'digest', 'comment.created');
    await queue(people.owner, ids.song, 'digest', 'version.created');
    await queue(people.owner, ids.song, 'immediate', 'lyrics.changed');
    expect(await deliverQueuedEmails(deps(), 'digest')).toMatchObject({ sent: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toMatch(/^2 updates in /);
    expect(sent[0]?.text).toContain('commented on Headlights');
    expect(sent[0]?.text).toContain('uploaded a new version of Headlights');
    expect(sent[0]?.text).not.toContain('edited the lyrics');
  });
});
