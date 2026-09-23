import { memberSubject } from '@youandfriends/authz';
import { AppError, type WorkspaceId } from '@youandfriends/contracts';
import { auditEvents, workspaces, type DirectDatabase } from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeStorageObject,
  makeTenant,
  makeUser,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  readMemberManagement,
  readWorkspaceSettings,
  renameCurrentWorkspace,
  type WorkspaceRequest,
} from '../settings';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING workspace settings tests: ${reason}`);

const QUOTA = 100 * 1024 ** 3;

/**
 * The settings surface, against a real database.
 *
 * The fixture (CLAUDE.md §13): an owner, an editor and a viewer in one workspace — so "owner-only"
 * is tested against the role just below it — and a **populated** second workspace with its own
 * objects, members and name, which is what any missing tenant filter would leak.
 */
describeWithDatabase('workspace settings', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: WorkspaceId;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let foreignWorkspaceId: WorkspaceId;
  let foreignOwnerId: string;

  beforeAll(async () => {
    database = await createTestDatabase('web_workspace_settings');
    db = database.db;

    const mine = await makeTenant(db);
    workspaceId = mine.workspace.id as WorkspaceId;
    ownerId = mine.user.id;
    const editor = await makeUser(db);
    const viewer = await makeUser(db);
    editorId = editor.id;
    viewerId = viewer.id;
    await addMember(db, workspaceId, editorId, 'editor');
    await addMember(db, workspaceId, viewerId, 'viewer');
    await makeStorageObject(db, workspaceId, { sizeBytes: 5 * 1024 ** 2 });

    const theirs = await makeTenant(db);
    foreignWorkspaceId = theirs.workspace.id as WorkspaceId;
    foreignOwnerId = theirs.user.id;
    await addMember(db, foreignWorkspaceId, (await makeUser(db)).id, 'editor');
    await makeStorageObject(db, foreignWorkspaceId, { sizeBytes: 7 * 1024 ** 3 });
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const as = (userId: string, target: WorkspaceId = workspaceId): WorkspaceRequest => ({
    db,
    subject: memberSubject(userId as never),
    workspaceId: target,
  });

  const deniedIn = async (target: string) =>
    (await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, target))).filter(
      (event) => event.action === 'access.denied',
    );

  async function refusal(operation: Promise<unknown>): Promise<AppError> {
    const error = await operation.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AppError);
    // 404-shaped to the client, whatever the true cause.
    expect((error as AppError).publicCode).toBe('not_found');
    return error as AppError;
  }

  describe('reading', () => {
    it('shows the owner the name, this workspace’s usage against the quota, and its members', async () => {
      const settings = await readWorkspaceSettings(as(ownerId), QUOTA);

      expect(settings.name).toBe('Test Workspace');
      // 5 MB here; the 7 GB next door must not appear.
      expect(settings.usage.usedBytes).toBe(5 * 1024 ** 2);
      expect(settings.quotaBytes).toBe(QUOTA);
      expect(settings.members.map((member) => [member.userId, member.role])).toEqual([
        [ownerId, 'owner'],
        [editorId, 'editor'],
        [viewerId, 'viewer'],
      ]);
      expect(settings.mayRename).toBe(true);
      expect(settings.mayManageMembers).toBe(true);
    });

    it('shows a collaborator the same page without the owner’s controls', async () => {
      const settings = await readWorkspaceSettings(as(editorId), QUOTA);
      expect(settings.mayRename).toBe(false);
      expect(settings.mayManageMembers).toBe(false);
    });

    it('shows addresses only to someone who manages members', async () => {
      // A viewer let in to hear one song must not leave with everyone's email address.
      const asViewer = await readWorkspaceSettings(as(viewerId), QUOTA);
      expect(asViewer.members.map((member) => member.email)).toEqual([null, null, null]);
      expect(asViewer.members.map((member) => member.displayName)).toHaveLength(3);

      const asOwner = await readWorkspaceSettings(as(ownerId), QUOTA);
      expect(asOwner.members.every((member) => member.email?.includes('@'))).toBe(true);
    });

    it('refuses someone outside the workspace, and records it there', async () => {
      const before = (await deniedIn(workspaceId)).length;

      await refusal(readWorkspaceSettings(as(foreignOwnerId), QUOTA));

      const denials = await deniedIn(workspaceId);
      expect(denials).toHaveLength(before + 1);
      expect(denials.at(-1)).toMatchObject({
        actorId: foreignOwnerId,
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { attemptedAction: 'view_settings' },
      });
    });
  });

  describe('member management', () => {
    it('is the owner’s', async () => {
      const members = await readMemberManagement(as(ownerId));
      expect(members).toHaveLength(3);
    });

    it('refuses the editor and the viewer, and records each refusal', async () => {
      for (const userId of [editorId, viewerId]) {
        const before = (await deniedIn(workspaceId)).length;
        await refusal(readMemberManagement(as(userId)));
        const denials = await deniedIn(workspaceId);
        expect(denials).toHaveLength(before + 1);
        expect(denials.at(-1)).toMatchObject({
          actorId: userId,
          metadata: { attemptedAction: 'manage_members' },
        });
      }
    });

    it('refuses the owner of a different workspace', async () => {
      // An owner, just not of this one. A check that asked "is this person an owner" without
      // naming the workspace would let them in.
      await refusal(readMemberManagement(as(foreignOwnerId)));
    });
  });

  describe('renaming', () => {
    const nameOf = async (id: string) =>
      (await db.select().from(workspaces).where(eq(workspaces.id, id)))[0]?.name;

    it('lets the owner rename, and records the name before and after', async () => {
      const { workspace, user } = await makeTenant(db);
      const request = as(user.id, workspace.id as WorkspaceId);

      expect(await renameCurrentWorkspace(request, '  Late Night Sessions  ')).toEqual({
        name: 'Late Night Sessions',
      });

      expect(await nameOf(workspace.id)).toBe('Late Night Sessions');
      const [event] = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspace.id));
      expect(event).toMatchObject({
        action: 'workspace.settings_changed',
        actorId: user.id,
        metadata: { field: 'name', from: 'Test Workspace', to: 'Late Night Sessions' },
      });
    });

    it('records nothing when the name did not change', async () => {
      const { workspace, user } = await makeTenant(db);
      await renameCurrentWorkspace(as(user.id, workspace.id as WorkspaceId), 'Test Workspace');
      expect(
        await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspace.id)),
      ).toHaveLength(0);
    });

    it('refuses an editor, leaves the name alone, and records the attempt', async () => {
      const before = await nameOf(workspaceId);
      await refusal(renameCurrentWorkspace(as(editorId), 'Taken Over'));
      expect(await nameOf(workspaceId)).toBe(before);
      expect((await deniedIn(workspaceId)).at(-1)).toMatchObject({
        actorId: editorId,
        metadata: { attemptedAction: 'rename' },
      });
    });

    it('refuses a name nobody should have to read', async () => {
      const { workspace, user } = await makeTenant(db);
      const request = as(user.id, workspace.id as WorkspaceId);

      const refused = [
        '',
        '   ',
        'x'.repeat(81),
        'Line\nbreak',
        'Escape\u001b[31m',
        // C1 control, line separator, right-to-left override, zero-width space, BOM.
        'Next\u0085line',
        'Para\u2028graph',
        'evil\u202Egnp.wav',
        '\u200B\u200B\u200B',
        // Inside the name: a leading or trailing one is whitespace to `trim()` and never stored.
        'Blue\uFEFFHour',
        42,
        null,
      ];
      for (const bad of refused) {
        const error = await renameCurrentWorkspace(request, bad).then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('validation_failed');
      }

      expect(await nameOf(workspace.id)).toBe('Test Workspace');
    });

    it('accepts names in any script, with emoji, and with the joiner emoji sequences need', async () => {
      const { workspace, user } = await makeTenant(db);
      const request = as(user.id, workspace.id as WorkspaceId);
      for (const good of ['Avery & Friends', 'Études', '東京セッション', 'Band 👩\u200D🎤', '#2']) {
        expect(await renameCurrentWorkspace(request, good)).toEqual({ name: good });
      }
    });

    it('checks permission before it looks at the input', async () => {
      // A validation error for a non-owner would confirm the form exists and accepts input; a
      // refusal says nothing.
      const error = await refusal(renameCurrentWorkspace(as(viewerId), ''));
      expect(error.code).toBe('forbidden');
    });
  });
});
