import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import { createAuthorizer, memberSubject } from '@youandfriends/authz';
import {
  ensureScopeLimitedMembership,
  upsertGrant,
  withTransaction,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeFolder,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LibraryContext } from '../context';
import {
  createLibraryFolder,
  deleteLibraryFolder,
  moveLibraryFolder,
  readLibraryTree,
  renameLibraryFolder,
} from '../folders';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING library folder use cases: ${reason}`);

function caught(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => null,
    (error: unknown) => error,
  );
}

describeWithDatabase('library folder use cases', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('library_folders');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  function contextFor(workspaceId: string, userId: string): LibraryContext {
    return {
      db,
      authz: createAuthorizer(db),
      subject: memberSubject(userId as UserId),
      workspaceId: workspaceId as WorkspaceId,
      userId,
    };
  }

  describe('readLibraryTree', () => {
    it('gives an owner every folder, all editable', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const a = await makeFolder(db, workspace.id, 'A');
      await makeFolder(db, workspace.id, 'B', a.id);

      const tree = await readLibraryTree(contextFor(workspace.id, owner.id));

      expect(tree.folders).toHaveLength(2);
      expect(tree.mayCreateAtRoot).toBe(true);
      expect(tree.editableFolderIds.size).toBe(2);
    });

    it('gives a viewer everything to see but nothing to edit', async () => {
      const { workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Read only');
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const tree = await readLibraryTree(contextFor(workspace.id, viewer.id));

      expect(tree.folders.map((f) => f.id)).toEqual([folder.id]);
      expect(tree.mayCreateAtRoot).toBe(false);
      expect(tree.editableFolderIds.size).toBe(0);
    });

    it('gives a scope-limited collaborator only their granted subtree', async () => {
      // The un-granted sibling is the row that makes this bite (CLAUDE.md §13): without it, a
      // query that accidentally returned every folder in the workspace would still pass.
      const { user: owner, workspace } = await makeTenant(db);
      const granted = await makeFolder(db, workspace.id, 'Granted');
      const nested = await makeFolder(db, workspace.id, 'Nested', granted.id);
      await makeFolder(db, workspace.id, 'Sibling');
      const collaborator = await makeUser(db);

      await withTransaction(db, async (tx) => {
        await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'folder',
          scopeId: granted.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'editor',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
        });
      });

      const tree = await readLibraryTree(contextFor(workspace.id, collaborator.id));

      expect(tree.folders.map((f) => f.id).sort()).toEqual([granted.id, nested.id].sort());
      expect(tree.mayCreateAtRoot).toBe(false);
      expect(tree.editableFolderIds).toEqual(new Set([granted.id, nested.id]));
    });

    it('never names an invisible ancestor in a granted folder’s own path or parentId', async () => {
      // Found in security review: filtering the *list* is not enough on its own. A folder
      // granted two levels under a workspace root the collaborator never sees still carried
      // that root's and its own parent's real ids in `path`/`parentId` before this was fixed —
      // both of them reaching the client regardless of neither ever appearing as its own row.
      const { user: owner, workspace } = await makeTenant(db);
      const invisibleRoot = await makeFolder(db, workspace.id, 'Unreleased album');
      const invisibleParent = await makeFolder(db, workspace.id, 'Stems', invisibleRoot.id);
      const granted = await makeFolder(db, workspace.id, 'Guest verse', invisibleParent.id);
      const collaborator = await makeUser(db);

      await withTransaction(db, async (tx) => {
        await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'folder',
          scopeId: granted.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'editor',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
        });
      });

      const tree = await readLibraryTree(contextFor(workspace.id, collaborator.id));

      expect(tree.folders.map((f) => f.id)).toEqual([granted.id]);
      const row = tree.folders[0]!;
      expect(row.parentId).toBeNull();
      expect(row.path).toBe(`/${granted.id}/`);
      expect(row.path).not.toContain(invisibleRoot.id);
      expect(row.path).not.toContain(invisibleParent.id);
    });
  });

  describe('createLibraryFolder', () => {
    it('lets an editor create a root folder', async () => {
      const { workspace } = await makeTenant(db);
      const editor = await makeUser(db);
      await addMember(db, workspace.id, editor.id, 'editor');

      const created = await createLibraryFolder(contextFor(workspace.id, editor.id), {
        parentId: null,
        name: 'Demos',
      });

      expect(created.name).toBe('Demos');
      expect(created.parentId).toBeNull();
    });

    it('refuses a viewer creating a root folder', async () => {
      const { workspace } = await makeTenant(db);
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const error = (await caught(
        createLibraryFolder(contextFor(workspace.id, viewer.id), {
          parentId: null,
          name: 'Nope',
        }),
      )) as { publicCode?: string } | null;
      expect(error?.publicCode).toBe('not_found');
    });

    it('reports a conflict for a duplicate name under the same parent', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const parent = await makeFolder(db, workspace.id, 'Parent');
      await makeFolder(db, workspace.id, 'Mixes', parent.id);

      const error = (await caught(
        createLibraryFolder(contextFor(workspace.id, owner.id), {
          parentId: parent.id,
          name: 'Mixes',
        }),
      )) as { code?: string } | null;

      expect(error?.code).toBe('conflict');
    });

    it('rejects a name made only of invisible characters', async () => {
      const { user: owner, workspace } = await makeTenant(db);

      const error = (await caught(
        createLibraryFolder(contextFor(workspace.id, owner.id), {
          parentId: null,
          name: '​​',
        }),
      )) as { code?: string } | null;

      expect(error?.code).toBe('validation_failed');
    });
  });

  describe('renameLibraryFolder', () => {
    it('renames in place', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Old');

      const renamed = await renameLibraryFolder(contextFor(workspace.id, owner.id), {
        folderId: folder.id,
        name: 'New',
      });

      expect(renamed.name).toBe('New');
    });

    it('refuses a folder outside the workspace, 404-shaped', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const other = await makeTenant(db);
      const foreign = await makeFolder(db, other.workspace.id, 'Theirs');

      const error = (await caught(
        renameLibraryFolder(contextFor(workspace.id, owner.id), {
          folderId: foreign.id,
          name: 'Stolen',
        }),
      )) as { publicCode?: string } | null;

      expect(error?.publicCode).toBe('not_found');
    });

    it('refuses a viewer, who may see the folder but not organize it', async () => {
      // The negative case `createLibraryFolder`'s own "refuses a viewer" test covers for create
      // but this file never covered for rename: deleting `assertMayEdit` from
      // `renameLibraryFolder` alone would leave every other test here green.
      const { workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Read only');
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const error = (await caught(
        renameLibraryFolder(contextFor(workspace.id, viewer.id), {
          folderId: folder.id,
          name: 'Renamed anyway',
        }),
      )) as { publicCode?: string } | null;

      expect(error?.publicCode).toBe('not_found');
    });

    it('refuses a scope-limited collaborator renaming a folder outside their grant', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const granted = await makeFolder(db, workspace.id, 'Granted');
      const untouched = await makeFolder(db, workspace.id, 'Untouched');
      const collaborator = await makeUser(db);

      await withTransaction(db, async (tx) => {
        await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'folder',
          scopeId: granted.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'editor',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
        });
      });

      const error = (await caught(
        renameLibraryFolder(contextFor(workspace.id, collaborator.id), {
          folderId: untouched.id,
          name: 'Taken over',
        }),
      )) as { publicCode?: string } | null;

      expect(error?.publicCode).toBe('not_found');
    });
  });

  describe('moveLibraryFolder', () => {
    it('moves a folder under a new parent', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Movable');
      const newHome = await makeFolder(db, workspace.id, 'New home');

      const moved = await moveLibraryFolder(contextFor(workspace.id, owner.id), {
        folderId: folder.id,
        newParentId: newHome.id,
      });

      expect(moved.parentId).toBe(newHome.id);
    });

    it('refuses moving a folder into its own descendant', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const parent = await makeFolder(db, workspace.id, 'Parent');
      const child = await makeFolder(db, workspace.id, 'Child', parent.id);

      const error = (await caught(
        moveLibraryFolder(contextFor(workspace.id, owner.id), {
          folderId: parent.id,
          newParentId: child.id,
        }),
      )) as { code?: string } | null;

      expect(error?.code).toBe('conflict');
    });

    it('refuses a collaborator moving a folder into a destination they cannot edit', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const granted = await makeFolder(db, workspace.id, 'Granted');
      const elsewhere = await makeFolder(db, workspace.id, 'Elsewhere');
      const collaborator = await makeUser(db);

      await withTransaction(db, async (tx) => {
        await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'folder',
          scopeId: granted.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'editor',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
        });
      });

      const moveInto = await makeFolder(db, workspace.id, 'Nested target', granted.id);

      const error = (await caught(
        moveLibraryFolder(contextFor(workspace.id, collaborator.id), {
          folderId: moveInto.id,
          newParentId: elsewhere.id,
        }),
      )) as { publicCode?: string } | null;
      expect(error?.publicCode).toBe('not_found');
    });
  });

  describe('deleteLibraryFolder', () => {
    it('soft-deletes the folder, which then drops out of the tree', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Gone soon');

      await deleteLibraryFolder(contextFor(workspace.id, owner.id), folder.id, 30);

      const tree = await readLibraryTree(contextFor(workspace.id, owner.id));
      expect(tree.folders.map((f) => f.id)).not.toContain(folder.id);
    });

    it('refuses a viewer, and leaves the folder in place', async () => {
      // Removing `assertMayEdit` from `deleteLibraryFolder` would only ever be caught by a
      // test like this one — the happy-path test above passes just the same either way.
      const { workspace } = await makeTenant(db);
      const folder = await makeFolder(db, workspace.id, 'Precious');
      const viewer = await makeUser(db);
      await addMember(db, workspace.id, viewer.id, 'viewer');

      const error = (await caught(
        deleteLibraryFolder(contextFor(workspace.id, viewer.id), folder.id, 30),
      )) as { publicCode?: string } | null;

      expect(error?.publicCode).toBe('not_found');

      const tree = await readLibraryTree(contextFor(workspace.id, viewer.id));
      expect(tree.folders.map((f) => f.id)).toContain(folder.id);
    });

    it('refuses a scope-limited collaborator deleting a folder outside their grant', async () => {
      const { user: owner, workspace } = await makeTenant(db);
      const granted = await makeFolder(db, workspace.id, 'Granted');
      const untouched = await makeFolder(db, workspace.id, 'Untouched');
      const collaborator = await makeUser(db);

      await withTransaction(db, async (tx) => {
        await ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId());
        await upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          scopeType: 'folder',
          scopeId: granted.id,
          subjectKind: 'member',
          subjectId: collaborator.id,
          role: 'editor',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
        });
      });

      const error = (await caught(
        deleteLibraryFolder(contextFor(workspace.id, collaborator.id), untouched.id, 30),
      )) as { publicCode?: string } | null;

      expect(error?.publicCode).toBe('not_found');
    });
  });
});
