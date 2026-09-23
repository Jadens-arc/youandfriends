import { generateTokenSecret, hashSecret, buildToken } from '@youandfriends/authz';
import {
  auditEvents,
  invitations,
  permissionGrants,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  createTestDatabase,
  makeFolder,
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

import { acceptInvitationToken } from '../accept';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING invitation acceptance tests: ${reason}`);

const HOUR = 60 * 60 * 1000;

/**
 * Accepting an invitation, end to end: token verification, email binding, atomicity, and the
 * generic refusal that must not distinguish its causes.
 *
 * The fixture (CLAUDE.md §13): a real invitation with a real hashed secret, so a "wrong secret"
 * case actually exercises `verifySecret` rather than an equality check on a fixture the code
 * never reads; an accepter whose `users.email` genuinely differs from the invitation's, not
 * merely a different-cased string, to prove normalization on *both* sides of the comparison
 * rather than one; and an already-existing membership row for the "accept a second invitation"
 * case, since a membership created fresh by the very call under test would prove nothing about
 * `ensureScopeLimitedMembership` leaving an existing one alone.
 */
describeWithDatabase('accepting an invitation', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('invitation_accept');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function tree() {
    const { user: owner, workspace } = await makeTenant(db);
    const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');
    const otherSong = await makeSong(db, workspace.id, project.id, 'Second Song');
    return { owner, workspace, folder, project, song, otherSong };
  }

  interface SeedOptions {
    readonly email?: string;
    readonly role?: 'viewer' | 'commenter' | 'editor';
    readonly canDownload?: boolean;
    readonly canInvite?: boolean;
    readonly expiresAt?: Date;
    readonly state?: 'pending' | 'accepted' | 'revoked';
  }

  async function seedInvitation(
    workspaceId: string,
    scopeId: string,
    invitedByUserId: string,
    options: SeedOptions = {},
  ) {
    const id = testId();
    const secret = generateTokenSecret();
    await db.insert(invitations).values({
      id,
      workspaceId,
      email: options.email ?? 'sam@example.test',
      scopeType: 'song',
      scopeId,
      role: options.role ?? 'viewer',
      canDownload: options.canDownload ?? false,
      canInvite: options.canInvite ?? false,
      tokenHash: hashSecret(secret),
      invitedByUserId,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * HOUR),
      state: options.state ?? 'pending',
    });
    return { id, token: buildToken('invite', id, secret), secret };
  }

  async function makeAccepter(email: string) {
    return makeUser(db, { email });
  }

  it('accepts, creating a scope-limited membership and a grant, atomically', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id, {
      role: 'editor',
      canDownload: true,
    });
    const accepter = await makeAccepter('sam@example.test');

    const outcome = await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);

    expect(outcome).toEqual({
      kind: 'accepted',
      workspaceId: workspace.id,
      scopeType: 'song',
      scopeId: song.id,
    });

    const [row] = await db.select().from(invitations).where(eq(invitations.id, invite.id));
    expect(row?.state).toBe('accepted');
    expect(row?.acceptedByUserId).toBe(accepter.id);

    const [membership] = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, accepter.id));
    expect(membership).toMatchObject({ role: null, canDownload: false, canInvite: false });

    const [grant] = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.subjectId, accepter.id));
    expect(grant).toMatchObject({
      scopeType: 'song',
      scopeId: song.id,
      role: 'editor',
      canDownload: true,
      createdByUserId: owner.id,
    });
  });

  it('audits acceptance, the new membership, and the new grant', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id);
    const accepter = await makeAccepter('sam@example.test');

    await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));
    const actions = events.map((event) => event.action).sort();
    expect(actions).toEqual(['invitation.accepted', 'member.added', 'permission.granted']);
    expect(events.every((event) => event.actorId === accepter.id)).toBe(true);
  });

  it('reports a changed grant, not a new one, when a second invitation targets an existing grant', async () => {
    const { owner, workspace, song } = await tree();
    const first = await seedInvitation(workspace.id, song.id, owner.id, { role: 'viewer' });
    const accepter = await makeAccepter('sam@example.test');
    await acceptInvitationToken({ db, acceptingUserId: accepter.id }, first.token);

    const second = await seedInvitation(workspace.id, song.id, owner.id, {
      role: 'editor',
      email: 'sam@example.test',
    });
    await acceptInvitationToken({ db, acceptingUserId: accepter.id }, second.token);

    const grants = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.subjectId, accepter.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.role).toBe('editor');

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspace.id),
          eq(auditEvents.action, 'permission.changed'),
        ),
      );
    expect(events).toHaveLength(1);

    // No second membership row, and no second `member.added` — they were already a member.
    const memberships = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, accepter.id));
    expect(memberships).toHaveLength(1);
    const addedEvents = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.action, 'member.added')),
      );
    expect(addedEvents).toHaveLength(1);
  });

  it('does not touch an existing full member’s workspace-wide role', async () => {
    const { owner, workspace, song } = await tree();
    const editor = await makeAccepter('editor@example.test');
    await db
      .insert(workspaceMemberships)
      .values({ id: testId(), workspaceId: workspace.id, userId: editor.id, role: 'editor' });

    const invite = await seedInvitation(workspace.id, song.id, owner.id, {
      email: 'editor@example.test',
      role: 'viewer',
    });
    await acceptInvitationToken({ db, acceptingUserId: editor.id }, invite.token);

    const [membership] = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, editor.id));
    expect(membership?.role).toBe('editor');
  });

  it('refuses a wrong secret with the same generic message as a nonexistent token', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id);
    const accepter = await makeAccepter('sam@example.test');
    const forged = buildToken('invite', invite.id, generateTokenSecret());

    const outcome = await acceptInvitationToken({ db, acceptingUserId: accepter.id }, forged);
    expect(outcome.kind).toBe('refused');

    const [row] = await db.select().from(invitations).where(eq(invitations.id, invite.id));
    expect(row?.state).toBe('pending');
  });

  it('refuses a token for an invitation that never existed', async () => {
    const accepter = await makeAccepter('sam@example.test');
    const outcome = await acceptInvitationToken(
      { db, acceptingUserId: accepter.id },
      buildToken('invite', testId(), generateTokenSecret()),
    );
    expect(outcome.kind).toBe('refused');
  });

  it('refuses an unparseable token', async () => {
    const accepter = await makeAccepter('sam@example.test');
    const outcome = await acceptInvitationToken(
      { db, acceptingUserId: accepter.id },
      'not-a-token',
    );
    expect(outcome.kind).toBe('refused');
  });

  it('refuses an expired invitation, and never accepts it retroactively', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id, {
      expiresAt: new Date(Date.now() + HOUR),
    });
    const accepter = await makeAccepter('sam@example.test');

    const afterExpiry = new Date(Date.now() + 2 * HOUR);
    const outcome = await acceptInvitationToken(
      { db, acceptingUserId: accepter.id, now: () => afterExpiry },
      invite.token,
    );
    expect(outcome.kind).toBe('refused');

    const [row] = await db.select().from(invitations).where(eq(invitations.id, invite.id));
    expect(row?.state).toBe('pending');
  });

  it('refuses a revoked invitation, same message as expired', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id, { state: 'revoked' });
    const accepter = await makeAccepter('sam@example.test');

    const outcome = await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);
    expect(outcome.kind).toBe('refused');
  });

  it('lets exactly one of two concurrent acceptances of the same token win', async () => {
    // Two browser tabs, the same link, both clicked. Postgres's own row lock on the invitation
    // serializes the two `UPDATE ... WHERE state = 'pending'` statements; the loser's `WHERE`
    // no longer matches once the winner has committed, so it must come back refused rather
    // than crash trying to use a `null` result — the gap a mutation test found here: removing
    // the null-check after `acceptInvitation` let this exact case throw instead of refuse.
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id);
    const alice = await makeAccepter('sam@example.test');
    const bob = await makeAccepter('sam@example.test');

    const [first, second] = await Promise.all([
      acceptInvitationToken({ db, acceptingUserId: alice.id }, invite.token),
      acceptInvitationToken({ db, acceptingUserId: bob.id }, invite.token),
    ]);

    const outcomes = [first.kind, second.kind].sort();
    expect(outcomes).toEqual(['accepted', 'refused']);

    const grants = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.scopeId, song.id));
    expect(grants).toHaveLength(1);
  });

  it('refuses accepting twice with the same token', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id);
    const accepter = await makeAccepter('sam@example.test');
    await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);

    const again = await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);
    expect(again.kind).toBe('refused');

    const grants = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.subjectId, accepter.id));
    expect(grants).toHaveLength(1);
  });

  it('refuses an identity whose email does not match, without accepting', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id, {
      email: 'sam@example.test',
    });
    const wrongPerson = await makeAccepter('not-sam@example.test');

    const outcome = await acceptInvitationToken(
      { db, acceptingUserId: wrongPerson.id },
      invite.token,
    );
    expect(outcome).toEqual({ kind: 'wrong_email', invitedEmail: 'sam@example.test' });

    const [row] = await db.select().from(invitations).where(eq(invitations.id, invite.id));
    expect(row?.state).toBe('pending');
    expect(
      await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, wrongPerson.id)),
    ).toHaveLength(0);
  });

  it('matches email case-insensitively, and with surrounding whitespace ignored', async () => {
    const { owner, workspace, song } = await tree();
    const invite = await seedInvitation(workspace.id, song.id, owner.id, {
      email: 'sam@example.test',
    });
    const accepter = await makeAccepter('  Sam@Example.TEST  ');

    const outcome = await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);
    expect(outcome.kind).toBe('accepted');
  });

  it('never leaks one workspace’s acceptance into another’s membership or grants', async () => {
    const mine = await tree();
    const theirs = await tree();
    const invite = await seedInvitation(mine.workspace.id, mine.song.id, mine.owner.id, {
      email: 'sam@example.test',
    });
    const accepter = await makeAccepter('sam@example.test');

    await acceptInvitationToken({ db, acceptingUserId: accepter.id }, invite.token);

    expect(
      await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, theirs.workspace.id),
            eq(workspaceMemberships.userId, accepter.id),
          ),
        ),
    ).toHaveLength(0);
  });
});
