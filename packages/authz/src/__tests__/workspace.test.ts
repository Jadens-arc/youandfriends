import {
  WORKSPACE_ACTIONS,
  type WorkspaceAction,
  type WorkspaceId,
} from '@youandfriends/contracts';
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
import { permissionGrants } from '@youandfriends/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { memberSubject, shareLinkSubject, syncTokenSubject, anonymous } from '../subjects';
import { assertCanInWorkspace, canInWorkspace, workspaceRoleOf } from '../workspace';
import { caught, expectNotFoundShape } from './helpers';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING workspace authorization tests: ${reason}`);

/**
 * Decisions about the workspace itself — its settings and its member list.
 *
 * The fixture has every row that could wrongly answer yes (CLAUDE.md §13):
 *  - one member at each role, so "owner-only" is tested against the role just below it;
 *  - a person who **owns a different workspace**, so a check that forgot the workspace id and
 *    asked only "is this person an owner anywhere" is caught;
 *  - an **owner-level grant on a folder** for an editor, so a check that consulted grants —
 *    which scope folders, projects, and songs, never the workspace — is caught too.
 */
describeWithDatabase('workspace-level authorization', () => {
  let database: TestDatabase;
  let workspaceId: WorkspaceId;
  let people: Record<'owner' | 'editor' | 'commenter' | 'viewer' | 'foreignOwner', string>;

  beforeAll(async () => {
    database = await createTestDatabase('authz_workspace');
    const { db } = database;

    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id as WorkspaceId;

    const editor = await makeUser(db);
    const commenter = await makeUser(db);
    const viewer = await makeUser(db);
    await addMember(db, workspaceId, editor.id, 'editor');
    await addMember(db, workspaceId, commenter.id, 'commenter');
    await addMember(db, workspaceId, viewer.id, 'viewer');

    const elsewhere = await makeTenant(db);

    // An owner grant on a folder in this workspace. Grants never reach the workspace itself.
    const folder = await makeFolder(db, workspaceId, 'Demos');
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId,
      scopeType: 'folder',
      scopeId: folder.id,
      subjectKind: 'member',
      subjectId: editor.id,
      role: 'owner',
      createdByUserId: tenant.user.id,
    });

    people = {
      owner: tenant.user.id,
      editor: editor.id,
      commenter: commenter.id,
      viewer: viewer.id,
      foreignOwner: elsewhere.user.id,
    };
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const member = (who: keyof typeof people) => memberSubject(people[who] as never);

  /** Who may do what. Anything not listed is refused. */
  const EXPECTED: Record<WorkspaceAction, readonly (keyof typeof people)[]> = {
    view_settings: ['owner', 'editor', 'commenter', 'viewer'],
    rename: ['owner'],
    manage_members: ['owner'],
  };

  it('covers every workspace action', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...WORKSPACE_ACTIONS].sort());
  });

  for (const action of WORKSPACE_ACTIONS) {
    for (const who of ['owner', 'editor', 'commenter', 'viewer', 'foreignOwner'] as const) {
      const allowed = EXPECTED[action].includes(who);
      it(`${allowed ? 'lets' : 'refuses'} ${who} ${action}`, async () => {
        expect(await canInWorkspace(database.db, member(who), action, workspaceId)).toBe(allowed);
      });
    }
  }

  it('reads the role from the membership, not from a grant', async () => {
    // The editor holds an owner grant on a folder. That makes them owner of the folder only.
    expect(await workspaceRoleOf(database.db, member('editor'), workspaceId)).toBe('editor');
  });

  it('refuses every subject that cannot hold a membership, without asking the database', async () => {
    for (const subject of [anonymous, shareLinkSubject('link'), syncTokenSubject('token')]) {
      expect(await workspaceRoleOf(database.db, subject, workspaceId)).toBeNull();
      expect(await canInWorkspace(database.db, subject, 'view_settings', workspaceId)).toBe(false);
    }
  });

  it('refuses 404-shaped, so a refusal does not confirm the workspace exists', async () => {
    expectNotFoundShape(
      await caught(
        assertCanInWorkspace(database.db, member('editor'), 'manage_members', workspaceId),
      ),
    );
    expectNotFoundShape(
      await caught(
        assertCanInWorkspace(database.db, member('foreignOwner'), 'view_settings', workspaceId),
      ),
    );
  });

  it('passes silently when allowed', async () => {
    await expect(
      assertCanInWorkspace(database.db, member('owner'), 'manage_members', workspaceId),
    ).resolves.toBeUndefined();
  });
});
