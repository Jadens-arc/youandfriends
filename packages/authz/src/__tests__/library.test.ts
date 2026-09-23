import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import { ensureScopeLimitedMembership, upsertGrant, withTransaction } from '@youandfriends/db';
import {
  createTestDatabase,
  makeFolder,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadVisibleFolders } from '../library';
import { memberSubject, shareLinkSubject } from '../subjects';
import { caught, expectNotFoundShape } from './helpers';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING library visibility tests: ${reason}`);

/**
 * `loadVisibleFolders` against a real database: the tenant-boundary refusal and the
 * scope-limited path, which `library.test.ts`'s pure suite cannot exercise because both depend
 * on a real membership row existing (or not) rather than on the value passed in directly.
 */
describeWithDatabase('loadVisibleFolders', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('library_visibility');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('refuses a subject with no membership row at all, 404-shaped', async () => {
    const { workspace } = await makeTenant(database.db);
    const folder = await makeFolder(database.db, workspace.id, 'Demos');
    const stranger = await makeUser(database.db);

    const error = await caught(
      loadVisibleFolders(
        database.db,
        memberSubject(stranger.id as UserId),
        workspace.id as WorkspaceId,
        [{ id: folder.id, path: folder.path }],
      ),
    );

    expectNotFoundShape(error);
  });

  it('refuses a subject kind that can never hold a workspace membership', async () => {
    const { workspace } = await makeTenant(database.db);

    const error = await caught(
      loadVisibleFolders(database.db, shareLinkSubject(testId()), workspace.id as WorkspaceId, []),
    );

    expectNotFoundShape(error);
  });

  it('gives a full member every live folder in the workspace', async () => {
    const { user: owner, workspace } = await makeTenant(database.db);
    const a = await makeFolder(database.db, workspace.id, 'A');
    const b = await makeFolder(database.db, workspace.id, 'B', a.id);

    const visible = await loadVisibleFolders(
      database.db,
      memberSubject(owner.id as UserId),
      workspace.id as WorkspaceId,
      [
        { id: a.id, path: a.path },
        { id: b.id, path: b.path },
      ],
    );

    expect(visible.map((folder) => folder.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('gives a scope-limited collaborator only the folder they were invited to, and its descendants', async () => {
    // The sibling folder is the row that makes this bite (CLAUDE.md §13): with no grant of its
    // own, it must be absent from the result, not merely unmentioned by a thinner fixture that
    // never gave the query a chance to leak it.
    const { user: owner, workspace } = await makeTenant(database.db);
    const invited = await makeFolder(database.db, workspace.id, 'Invited');
    const nested = await makeFolder(database.db, workspace.id, 'Nested', invited.id);
    const sibling = await makeFolder(database.db, workspace.id, 'Sibling');
    const collaborator = await makeUser(database.db);

    await withTransaction(database.db, async (tx) => {
      await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
      await upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'folder',
        scopeId: invited.id,
        subjectKind: 'member',
        subjectId: collaborator.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      });
    });

    const visible = await loadVisibleFolders(
      database.db,
      memberSubject(collaborator.id as UserId),
      workspace.id as WorkspaceId,
      [invited, nested, sibling].map((folder) => ({ id: folder.id, path: folder.path })),
    );

    expect(visible.map((folder) => folder.id).sort()).toEqual([invited.id, nested.id].sort());
  });
});
