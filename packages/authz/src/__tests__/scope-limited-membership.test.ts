import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
  upsertGrant,
  withTransaction,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthorizer } from '../authorizer';
import { memberSubject, type Target } from '../subjects';
import { canInWorkspace } from '../workspace';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING scope-limited membership tests: ${reason}`);

/**
 * The property task `032` exists to guarantee, proven against a real database rather than only
 * in `resolve.ts`'s pure matrix (`matrix.ts`'s named cases cover the same claim at the resolver
 * level): a scope-limited collaborator's null-role membership row
 * (`ensureScopeLimitedMembership`) contributes no baseline anywhere else in the workspace.
 *
 * The fixture rule (CLAUDE.md §13) is why this needs its own file rather than a line added to
 * `seeded-grants.test.ts`: the row that makes this bite is a *sibling* scope with no grant of
 * its own, in the *same* workspace as the one the collaborator was actually invited to. Without
 * it, a regression as simple as `row.role ?? 'viewer'` in `loadMembership`'s SQL path — which
 * the matrix's direct call into `resolve()` never exercises — could ship unnoticed, because
 * every other real-database authz test's membership rows carry a real role.
 */
describeWithDatabase('a scope-limited collaborator’s access', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('scope_limited_membership');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function tree() {
    const { user: owner, workspace } = await makeTenant(db);
    const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const invited = await makeSong(db, workspace.id, project.id, 'Invited song');
    const sibling = await makeSong(db, workspace.id, project.id, 'Sibling song');
    return { owner, workspace, folder, project, invited, sibling };
  }

  it('grants exactly the invited scope, and nothing at a sibling scope in the same workspace', async () => {
    const { owner, workspace, invited, sibling } = await tree();
    const collaborator = await makeUser(db);

    await withTransaction(db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: invited.id,
        subjectKind: 'member',
        subjectId: collaborator.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      });
    });

    const authz = createAuthorizer(db);
    const subject = memberSubject(collaborator.id as UserId);

    const invitedTarget: Target = {
      workspaceId: workspace.id as WorkspaceId,
      scopeType: 'song',
      scopeId: invited.id,
    };
    const atInvited = await authz.resolveAccess(subject, invitedTarget);
    expect(atInvited.role).toBe('viewer');

    // The row that makes a `role ?? 'viewer'`-shaped regression visible: a sibling song in the
    // very same workspace, with no grant of its own — a non-null baseline here is exactly the
    // leak this design exists to prevent.
    const siblingTarget: Target = {
      workspaceId: workspace.id as WorkspaceId,
      scopeType: 'song',
      scopeId: sibling.id,
    };
    const atSibling = await authz.resolveAccess(subject, siblingTarget);
    expect(atSibling.role).toBeNull();
    expect(atSibling.canDownload).toBe(false);

    // And the owner's own access to both is untouched — this is a claim about the
    // collaborator's subject, not about the workspace.
    const ownerSubject = memberSubject(owner.id as UserId);
    expect((await authz.resolveAccess(ownerSubject, invitedTarget)).role).toBe('owner');
    expect((await authz.resolveAccess(ownerSubject, siblingTarget)).role).toBe('owner');
  }, 60_000);

  it('never reaches a workspace-level action either', async () => {
    const { workspace } = await tree();
    const collaborator = await makeUser(db);

    await withTransaction(db, (tx) =>
      ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId()),
    );

    const subject = memberSubject(collaborator.id as UserId);
    const workspaceId = workspace.id as WorkspaceId;

    // `workspaceRoleOf` reads this same null role; a scope grant is never a substitute for
    // workspace-wide membership, whatever it grants at its own scope.
    expect(await canInWorkspace(db, subject, 'view_settings', workspaceId)).toBe(false);
    expect(await canInWorkspace(db, subject, 'manage_members', workspaceId)).toBe(false);
  }, 60_000);
});
