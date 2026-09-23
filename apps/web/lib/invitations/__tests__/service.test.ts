import { createAuthorizer, memberSubject, parseToken, verifySecret } from '@youandfriends/authz';
import { AppError, type WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  invitations,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
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

import type { InvitationContext } from '../context';
import { pendingInvitations, revokeInvitationById, sendInvitation } from '../service';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING invitation service tests: ${reason}`);

/**
 * Sending and revoking invitations, against a real database and the real authorizer.
 *
 * The fixture (CLAUDE.md §13): an owner, a `can_invite` editor delegate, and a plain viewer —
 * so "may invite" is tested against a role one step below it, and "may not exceed the
 * inviter's own access" needs a delegate whose role and capabilities genuinely sit below what
 * an invitation might ask for. A second, populated workspace supplies the row a missing tenant
 * filter would leak.
 */
describeWithDatabase('sending and revoking invitations', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('invitation_service');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function tree() {
    const { user: owner, workspace } = await makeTenant(db);
    // `makeTenant`'s owner is deliberately `canInvite: false` (asserted by
    // `packages/authz/src/__tests__/smoke.test.ts`) — a shared factory's own baseline, not a
    // stand-in for production, where `provisionWorkspace` always sets an owner's `canInvite`
    // true. This suite is about the invite capability specifically, so it grants it here
    // rather than changing what every other test in the repo relies on `makeTenant` to mean.
    await db
      .update(workspaceMemberships)
      .set({ canInvite: true })
      .where(eq(workspaceMemberships.userId, owner.id));
    const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');
    return { owner, workspace, folder, project, song };
  }

  function contextFor(
    workspaceId: string,
    userId: string,
    overrides: Partial<InvitationContext> = {},
  ): InvitationContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as never),
      workspaceId: workspaceId as WorkspaceId,
      userId,
      ...overrides,
    };
  }

  const request = (overrides: Partial<Parameters<typeof sendInvitation>[1] & object> = {}) => ({
    email: 'sam@example.test',
    scopeType: 'song' as const,
    role: 'viewer' as const,
    canDownload: false,
    canInvite: false,
    ...overrides,
  });

  async function refusal(operation: Promise<unknown>): Promise<AppError> {
    const error = await operation.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  describe('sendInvitation', () => {
    it('lets the owner invite, and returns a working token', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );

      expect(sent.invitationId).toBeTruthy();
      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, sent.invitationId));
      expect(row?.state).toBe('pending');
      expect(row?.email).toBe('sam@example.test');

      // The token really does verify against the stored hash — not a token disconnected from
      // what was written.
      const parsed = parseToken('invite', sent.token);
      expect(parsed?.id).toBe(sent.invitationId);
      expect(verifySecret(parsed?.secret ?? '', row?.tokenHash ?? '')).toBe(true);
    });

    it('audits the invitation, scoped to what was offered', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id, role: 'editor' }),
      );

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspace.id),
            eq(auditEvents.action, 'invitation.created'),
          ),
        );
      expect(event).toMatchObject({
        actorId: owner.id,
        targetType: 'invitation',
        targetId: sent.invitationId,
        metadata: { scopeType: 'song', scopeId: song.id, role: 'editor' },
      });
    });

    it('lets a can_invite delegate invite at or below their own access', async () => {
      const { workspace, song } = await tree();
      const delegate = await makeUser(db);
      await addMember(db, workspace.id, delegate.id, 'editor');
      await db
        .update(workspaceMemberships)
        .set({ canInvite: true })
        .where(eq(workspaceMemberships.userId, delegate.id));

      const sent = await sendInvitation(
        contextFor(workspace.id, delegate.id),
        request({ scopeId: song.id, role: 'viewer' }),
      );
      expect(sent.invitationId).toBeTruthy();
    });

    it('refuses a delegate inviting above their own role', async () => {
      const { workspace, song } = await tree();
      const delegate = await makeUser(db);
      await addMember(db, workspace.id, delegate.id, 'commenter');
      await db
        .update(workspaceMemberships)
        .set({ canInvite: true })
        .where(eq(workspaceMemberships.userId, delegate.id));

      const error = await refusal(
        sendInvitation(
          contextFor(workspace.id, delegate.id),
          request({ scopeId: song.id, role: 'editor' }),
        ),
      );
      expect(error.code).toBe('validation_failed');
    });

    it('refuses someone with no invite capability at all, 404-shaped', async () => {
      const { workspace, song } = await tree();
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const error = await refusal(
        sendInvitation(contextFor(workspace.id, viewer.id), request({ scopeId: song.id })),
      );
      expect(error.publicCode).toBe('not_found');
    });

    it('refuses a scope id from another workspace, 404-shaped — never confirming it exists', async () => {
      const { owner, workspace } = await tree();
      const foreign = await tree();

      const error = await refusal(
        sendInvitation(contextFor(workspace.id, owner.id), request({ scopeId: foreign.song.id })),
      );
      expect(error.publicCode).toBe('not_found');
    });

    it('refuses a second live invitation to the same address and scope, as a conflict', async () => {
      const { owner, workspace, song } = await tree();
      await sendInvitation(contextFor(workspace.id, owner.id), request({ scopeId: song.id }));

      const error = await refusal(
        sendInvitation(contextFor(workspace.id, owner.id), request({ scopeId: song.id })),
      );
      expect(error.code).toBe('conflict');
    });

    it('refuses an invalid request before touching the database', async () => {
      const { owner, workspace, song } = await tree();
      const error = await refusal(
        sendInvitation(
          contextFor(workspace.id, owner.id),
          request({ scopeId: song.id, email: 'not-an-email' }),
        ),
      );
      expect(error.code).toBe('validation_failed');

      const rows = await db
        .select()
        .from(invitations)
        .where(eq(invitations.workspaceId, workspace.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('revokeInvitationById', () => {
    it('revokes a pending invitation and audits it', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );

      await revokeInvitationById(contextFor(workspace.id, owner.id), sent.invitationId);

      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, sent.invitationId));
      expect(row?.state).toBe('revoked');
      const [event] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspace.id),
            eq(auditEvents.action, 'invitation.revoked'),
          ),
        );
      expect(event?.targetId).toBe(sent.invitationId);
    });

    it('lets a delegate revoke an invitation someone else sent, at a scope they may invite to', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );

      const delegate = await makeUser(db);
      await addMember(db, workspace.id, delegate.id, 'editor');
      await db
        .update(workspaceMemberships)
        .set({ canInvite: true })
        .where(eq(workspaceMemberships.userId, delegate.id));

      await revokeInvitationById(contextFor(workspace.id, delegate.id), sent.invitationId);
      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, sent.invitationId));
      expect(row?.state).toBe('revoked');
    });

    it('refuses someone with no invite capability at that scope', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const error = await refusal(
        revokeInvitationById(contextFor(workspace.id, viewer.id), sent.invitationId),
      );
      expect(error.publicCode).toBe('not_found');

      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, sent.invitationId));
      expect(row?.state).toBe('pending');
    });

    it('refuses an id from a different workspace, 404-shaped', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );
      const foreign = await tree();

      const error = await refusal(
        revokeInvitationById(contextFor(foreign.workspace.id, foreign.owner.id), sent.invitationId),
      );
      expect(error.publicCode).toBe('not_found');

      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, sent.invitationId));
      expect(row?.state).toBe('pending');
    });

    it('refuses to revoke an invitation that is already revoked', async () => {
      const { owner, workspace, song } = await tree();
      const sent = await sendInvitation(
        contextFor(workspace.id, owner.id),
        request({ scopeId: song.id }),
      );
      await revokeInvitationById(contextFor(workspace.id, owner.id), sent.invitationId);

      const error = await refusal(
        revokeInvitationById(contextFor(workspace.id, owner.id), sent.invitationId),
      );
      expect(error.code).toBe('conflict');
    });
  });

  describe('pendingInvitations', () => {
    it('is the owner’s to read', async () => {
      const { owner, workspace, song } = await tree();
      await sendInvitation(contextFor(workspace.id, owner.id), request({ scopeId: song.id }));

      const pending = await pendingInvitations(contextFor(workspace.id, owner.id));
      expect(pending).toHaveLength(1);
    });

    it('refuses a non-owner, 404-shaped', async () => {
      const { owner, workspace, song } = await tree();
      await sendInvitation(contextFor(workspace.id, owner.id), request({ scopeId: song.id }));
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      const error = await refusal(pendingInvitations(contextFor(workspace.id, editor.id)));
      expect(error.publicCode).toBe('not_found');
    });
  });
});
