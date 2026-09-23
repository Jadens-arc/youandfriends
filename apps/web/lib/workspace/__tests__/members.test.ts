import { memberSubject } from '@youandfriends/authz';
import { AppError, type WorkspaceId } from '@youandfriends/contracts';
import {
  auditEvents,
  permissionGrants,
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

import type { MemberManagementContext } from '../members';
import { changeMemberRole, removeMember } from '../members';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING member management tests: ${reason}`);

/**
 * Changing a full member's role, and removing members — owner-only, and the "at least one
 * owner" guard.
 *
 * The fixture (CLAUDE.md §13): a workspace with **two** owners for every "demote/remove an
 * owner" case, so the guard is proven against a workspace that would genuinely become
 * ownerless, not one where the guard could never fire; a scope-limited collaborator (a real
 * `permission_grants` row, not just an empty membership) for "removal clears grants too."
 */
describeWithDatabase('managing full members', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('member_management');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  function contextFor(
    workspaceId: string,
    actingUserId: string,
    overrides: Partial<MemberManagementContext> = {},
  ): MemberManagementContext {
    return {
      db,
      subject: memberSubject(actingUserId as never),
      workspaceId: workspaceId as WorkspaceId,
      actingUserId,
      ...overrides,
    };
  }

  async function refusal(operation: Promise<unknown>): Promise<AppError> {
    const error = await operation.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  describe('changeMemberRole', () => {
    it('lets the owner change another member’s role, and audits it', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      await changeMemberRole(contextFor(workspace.id, owner.id), editor.id, 'viewer');

      const [row] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, editor.id));
      expect(row?.role).toBe('viewer');

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspace.id),
            eq(auditEvents.action, 'member.role_changed'),
          ),
        );
      expect(event).toMatchObject({
        actorId: owner.id,
        targetId: editor.id,
        metadata: { from: 'editor', to: 'viewer' },
      });
    });

    it('records nothing when the role does not change', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      await changeMemberRole(contextFor(workspace.id, owner.id), editor.id, 'editor');

      expect(
        await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspace.id)),
      ).toHaveLength(0);
    });

    it('lets an owner promote another member to owner', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      await changeMemberRole(contextFor(workspace.id, owner.id), editor.id, 'owner');

      const [row] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, editor.id));
      expect(row?.role).toBe('owner');
    });

    it('refuses to demote the sole owner, and changes nothing', async () => {
      const { user: owner, workspace } = await makeTenant(db);

      const error = await refusal(
        changeMemberRole(contextFor(workspace.id, owner.id), owner.id, 'editor'),
      );
      expect(error.code).toBe('conflict');

      const [row] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, owner.id));
      expect(row?.role).toBe('owner');
    });

    it('lets one of two owners be demoted, leaving the other', async () => {
      const { user: firstOwner, workspace } = await makeTenant(db);
      const secondOwner = await makeUser(db);
      await addMember(db, workspace.id, secondOwner.id, 'owner');

      await changeMemberRole(contextFor(workspace.id, firstOwner.id), secondOwner.id, 'editor');

      const [row] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, secondOwner.id));
      expect(row?.role).toBe('editor');
    });

    it('refuses to change a scope-limited collaborator’s role, without touching their row', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
      const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
      const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');
      const collaborator = await makeUser(db);
      const membershipId = testId();
      await db.insert(workspaceMemberships).values({
        id: membershipId,
        workspaceId: workspace.id,
        userId: collaborator.id,
        role: null,
        canDownload: false,
        canInvite: false,
      });
      await db.insert(permissionGrants).values({
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: collaborator.id,
        role: 'viewer',
        createdByUserId: owner.id,
      });

      const error = await refusal(
        changeMemberRole(contextFor(workspace.id, owner.id), collaborator.id, 'editor'),
      );
      expect(error.publicCode).toBe('not_found');

      const [row] = await db
        .select()
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.userId, collaborator.id));
      // Still null — this call must never be the thing that silently promotes a scope-limited
      // collaborator to a full member.
      expect(row?.role).toBeNull();
    });

    it('refuses a non-owner, 404-shaped', async () => {
      const { workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');
      const target = await makeUser(db);
      await addMember(db, workspace.id, target.id, 'viewer');

      const error = await refusal(
        changeMemberRole(contextFor(workspace.id, editor.id), target.id, 'editor'),
      );
      expect(error.publicCode).toBe('not_found');
    });

    it('serializes two owners demoted at once, so exactly one succeeds and the workspace never reaches zero owners', async () => {
      // Same write-skew shape as `removeMember`'s concurrent case below, exercised against
      // `updateMembershipRole` (an update under `FOR UPDATE` on the target row) rather than a
      // delete — a distinct code path sharing the same `lockWorkspaceForMembershipWrite` fix,
      // so it gets its own proof rather than resting on the removal case's.
      for (let trial = 0; trial < 8; trial += 1) {
        const { user: firstOwner, workspace } = await makeTenant(db);
        const secondOwner = await makeUser(db);
        await addMember(db, workspace.id, secondOwner.id, 'owner');

        const [firstResult, secondResult] = await Promise.allSettled([
          changeMemberRole(contextFor(workspace.id, firstOwner.id), firstOwner.id, 'editor'),
          changeMemberRole(contextFor(workspace.id, secondOwner.id), secondOwner.id, 'editor'),
        ]);

        const succeeded = [firstResult, secondResult].filter((r) => r.status === 'fulfilled');
        const failed = [firstResult, secondResult].filter((r) => r.status === 'rejected');
        expect(succeeded, `trial ${trial}`).toHaveLength(1);
        expect(failed, `trial ${trial}`).toHaveLength(1);

        const rejection = failed[0] as PromiseRejectedResult;
        expect(rejection.reason, `trial ${trial}`).toBeInstanceOf(AppError);
        expect((rejection.reason as AppError).code, `trial ${trial}`).toBe('conflict');

        const remainingOwners = await db
          .select()
          .from(workspaceMemberships)
          .where(
            and(
              eq(workspaceMemberships.workspaceId, workspace.id),
              eq(workspaceMemberships.role, 'owner'),
            ),
          );
        expect(remainingOwners, `trial ${trial}`).toHaveLength(1);
      }
    }, 60_000);

    it('refuses someone with no membership row at all', async () => {
      const { user: owner, workspace } = await makeTenant(db);

      const error = await refusal(
        changeMemberRole(contextFor(workspace.id, owner.id), testId(), 'editor'),
      );
      expect(error.publicCode).toBe('not_found');
    });

    it('does not touch a role in a different workspace', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      const person = await makeUser(db);
      await addMember(db, mine.workspace.id, person.id, 'editor');
      await addMember(db, theirs.workspace.id, person.id, 'editor');

      await changeMemberRole(contextFor(mine.workspace.id, mine.user.id), person.id, 'viewer');

      const [inTheirs] = await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, theirs.workspace.id),
            eq(workspaceMemberships.userId, person.id),
          ),
        );
      expect(inTheirs?.role).toBe('editor');
    });
  });

  describe('removeMember', () => {
    it('removes a member and audits it', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      await removeMember(contextFor(workspace.id, owner.id), editor.id);

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, editor.id)),
      ).toHaveLength(0);

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.action, 'member.removed')),
        );
      expect(event).toMatchObject({ actorId: owner.id, targetId: editor.id });
    });

    it('clears every grant a scope-limited collaborator held, not only their membership row', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
      const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
      const songA = await makeSong(db, workspace.id, project.id, 'Song A');
      const songB = await makeSong(db, workspace.id, project.id, 'Song B');
      const collaborator = await makeUser(db);
      await db.insert(workspaceMemberships).values({
        id: testId(),
        workspaceId: workspace.id,
        userId: collaborator.id,
        role: null,
        canDownload: false,
        canInvite: false,
      });
      for (const song of [songA, songB]) {
        await db.insert(permissionGrants).values({
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'song',
          scopeId: song.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'viewer',
          createdByUserId: owner.id,
        });
      }

      await removeMember(contextFor(workspace.id, owner.id), collaborator.id);

      expect(
        await db
          .select()
          .from(permissionGrants)
          .where(eq(permissionGrants.subjectId, collaborator.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, collaborator.id)),
      ).toHaveLength(0);
    });

    it('does not clear another member’s grants in the same workspace', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
      const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
      const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');
      const [toRemove, toKeep] = await Promise.all([makeUser(db), makeUser(db)]);
      for (const person of [toRemove, toKeep]) {
        await db.insert(workspaceMemberships).values({
          id: testId(),
          workspaceId: workspace.id,
          userId: person.id,
          role: null,
          canDownload: false,
          canInvite: false,
        });
        await db.insert(permissionGrants).values({
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'song',
          scopeId: song.id,
          subjectKind: 'member',
          subjectId: person.id,
          role: 'viewer',
          createdByUserId: owner.id,
        });
      }

      await removeMember(contextFor(workspace.id, owner.id), toRemove.id);

      expect(
        await db.select().from(permissionGrants).where(eq(permissionGrants.subjectId, toKeep.id)),
      ).toHaveLength(1);
    });

    it('refuses the sole owner removing themselves — the one reachable path to zero owners', async () => {
      // Only an owner ever passes `manage_members`, so the only way this guard can fire is an
      // owner targeting their own id while no one else holds the role. A fixture with a
      // *different* actor could never reach this branch at all — it would be refused earlier,
      // by the authorization gate, proving nothing about the owner-count guard itself.
      const { user: owner, workspace } = await makeTenant(db);

      const error = await refusal(removeMember(contextFor(workspace.id, owner.id), owner.id));
      expect(error.code).toBe('conflict');

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, owner.id)),
      ).toHaveLength(1);
    });

    it('lets one of two owners remove the other', async () => {
      const { user: firstOwner, workspace } = await makeTenant(db);
      const secondOwner = await makeUser(db);
      await addMember(db, workspace.id, secondOwner.id, 'owner');

      await removeMember(contextFor(workspace.id, firstOwner.id), secondOwner.id);

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, secondOwner.id)),
      ).toHaveLength(0);
    });

    it('lets an owner remove themselves — leaving — when another owner remains', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const secondOwner = await makeUser(db);
      await addMember(db, workspace.id, secondOwner.id, 'owner');

      await removeMember(contextFor(workspace.id, owner.id), owner.id);

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, owner.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, secondOwner.id)),
      ).toHaveLength(1);
    });

    it('refuses a non-owner, 404-shaped, and removes nothing', async () => {
      const { workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');
      const target = await makeUser(db);
      await addMember(db, workspace.id, target.id, 'viewer');

      const error = await refusal(removeMember(contextFor(workspace.id, editor.id), target.id));
      expect(error.publicCode).toBe('not_found');

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(eq(workspaceMemberships.userId, target.id)),
      ).toHaveLength(1);
    });

    it('serializes two owners removed at once, so exactly one succeeds and the workspace never reaches zero owners', async () => {
      // The row that makes the write-skew race bite: `countOwners` is an unlocked read, so
      // two owners removed on two different connections at the same moment can each see the
      // *other* still as owner (neither write has committed yet) and both conclude "someone
      // else is left" — without `lockWorkspaceForMembershipWrite` serializing them first, both
      // proceed and both commit, leaving zero owners despite the guard (found in security
      // review, task `032`). Needs genuinely concurrent transactions on separate connections —
      // sequential `await`s would never exercise this at all, which is exactly why the bug
      // shipped past every other test in this file.
      //
      // The interleaving that trips the race depends on scheduling, so one trial catching it
      // is luck, not proof: run against the fixed code, this failed on roughly one run in
      // three when tried without `lockWorkspaceForMembershipWrite` in place. A dozen fresh
      // trials, each required to hold the invariant, is what actually distinguishes "fixed"
      // from "usually doesn't reproduce".
      for (let trial = 0; trial < 12; trial += 1) {
        const { user: firstOwner, workspace } = await makeTenant(db);
        const secondOwner = await makeUser(db);
        await addMember(db, workspace.id, secondOwner.id, 'owner');

        const [firstResult, secondResult] = await Promise.allSettled([
          removeMember(contextFor(workspace.id, firstOwner.id), firstOwner.id),
          removeMember(contextFor(workspace.id, secondOwner.id), secondOwner.id),
        ]);

        const succeeded = [firstResult, secondResult].filter((r) => r.status === 'fulfilled');
        const failed = [firstResult, secondResult].filter((r) => r.status === 'rejected');
        // Never both (zero owners, the bug) and never neither (an overly strict guard would
        // be a different bug) — exactly one of two concurrent self-removals may win.
        expect(succeeded, `trial ${trial}`).toHaveLength(1);
        expect(failed, `trial ${trial}`).toHaveLength(1);

        const rejection = failed[0] as PromiseRejectedResult;
        expect(rejection.reason, `trial ${trial}`).toBeInstanceOf(AppError);
        expect((rejection.reason as AppError).code, `trial ${trial}`).toBe('conflict');

        const remainingOwners = await db
          .select()
          .from(workspaceMemberships)
          .where(
            and(
              eq(workspaceMemberships.workspaceId, workspace.id),
              eq(workspaceMemberships.role, 'owner'),
            ),
          );
        expect(remainingOwners, `trial ${trial}`).toHaveLength(1);
      }
    }, 60_000);

    it('does not remove a membership from a different workspace', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      const person = await makeUser(db);
      await addMember(db, mine.workspace.id, person.id, 'viewer');
      await addMember(db, theirs.workspace.id, person.id, 'viewer');

      await removeMember(contextFor(mine.workspace.id, mine.user.id), person.id);

      expect(
        await db
          .select()
          .from(workspaceMemberships)
          .where(
            and(
              eq(workspaceMemberships.workspaceId, theirs.workspace.id),
              eq(workspaceMemberships.userId, person.id),
            ),
          ),
      ).toHaveLength(1);
    });
  });
});
