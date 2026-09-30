import { ACTIONS, type WorkspaceId } from '@youandfriends/contracts';
import {
  permissionGrants,
  syncDevices,
  syncTokens,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeFolder,
  makeProject,
  makeSong,
  makeSyncToken,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthorizer } from '../authorizer';
import { deleteEntity, restoreEntity } from '../lifecycle';
import { syncTokenSubject, type Target } from '../subjects';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING sync token tests: ${reason}`);

/**
 * The sync-token subject (task `110`, ADR 0005, `docs/THREAT_MODEL.md` T7) against a real database
 * and the real authorizer. Every case has something to refuse: a song inside the destination
 * project, the folder around it, a sibling project, another workspace's project the token was
 * (wrongly) granted, and tokens revoked, expired, on a revoked device, or paired by someone who
 * has since lost access.
 */
describeWithDatabase('sync tokens', () => {
  let database: TestDatabase;
  let db: DirectDatabase;
  let workspaceId: WorkspaceId;
  let ownerId: string;
  const ids = {} as Record<'folder' | 'destination' | 'sibling' | 'song' | 'foreign', string>;
  let foreignWorkspace: WorkspaceId;

  const at = (scopeType: Target['scopeType'], scopeId: string, workspace = workspaceId) => ({
    workspaceId: workspace,
    scopeType,
    scopeId,
  });
  const can = (tokenId: string, action: (typeof ACTIONS)[number], target: Target) =>
    createAuthorizer(db).can(syncTokenSubject(tokenId), action, target);

  beforeAll(async () => {
    database = await createTestDatabase('sync_tokens');
    db = database.db;
    const tenant = await makeTenant(db);
    workspaceId = tenant.workspace.id as WorkspaceId;
    ownerId = tenant.user.id;
    ids.folder = (await makeFolder(db, workspaceId, 'Sessions')).id;
    ids.destination = (await makeProject(db, workspaceId, 'Night Drive', ids.folder)).id;
    ids.sibling = (await makeProject(db, workspaceId, 'Private', ids.folder)).id;
    ids.song = (await makeSong(db, workspaceId, ids.destination, 'Headlights')).id;
    const foreign = await makeTenant(db);
    foreignWorkspace = foreign.workspace.id as WorkspaceId;
    ids.foreign = (await makeProject(db, foreignWorkspace, 'Theirs')).id;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('may add to its destination’s Project Files, and do nothing else there', async () => {
    const { tokenId } = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    expect(await can(tokenId, 'edit', at('project', ids.destination))).toBe(true);
    // Not read, not download, not comment, not manage permissions, not invite.
    for (const action of ACTIONS.filter((candidate) => candidate !== 'edit')) {
      expect(await can(tokenId, action, at('project', ids.destination)), action).toBe(false);
    }
  });

  it('reaches nothing inside or around its destination: not a song’s lyrics or comments, not the folder', async () => {
    const { tokenId } = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    // Grants on the song and the folder themselves — as a bug elsewhere might write. A token is
    // still only ever a project's uploader: these must not count.
    for (const [scopeType, scopeId] of [
      ['song', ids.song],
      ['folder', ids.folder],
    ] as const) {
      await db.insert(permissionGrants).values({
        id: testId(),
        workspaceId,
        scopeType,
        scopeId,
        subjectKind: 'sync_token',
        subjectId: tokenId,
        role: 'owner',
        createdByUserId: ownerId,
      });
    }
    for (const action of ACTIONS) {
      expect(await can(tokenId, action, at('song', ids.song)), `song ${action}`).toBe(false);
      expect(await can(tokenId, action, at('folder', ids.folder)), `folder ${action}`).toBe(false);
      expect(await can(tokenId, action, at('project', ids.sibling)), `sibling ${action}`).toBe(
        false,
      );
    }
  });

  it('cannot reach another workspace, even with a grant pointing there', async () => {
    const { tokenId } = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    await db.insert(permissionGrants).values({
      id: testId(),
      workspaceId: foreignWorkspace,
      scopeType: 'project',
      scopeId: ids.foreign,
      subjectKind: 'sync_token',
      subjectId: tokenId,
      role: 'owner',
    });
    expect(await can(tokenId, 'edit', at('project', ids.foreign, foreignWorkspace))).toBe(false);
    expect(await can(tokenId, 'edit', at('project', ids.foreign))).toBe(false);
  });

  it('stops when revoked, expired, or its device is disconnected — on the very next check', async () => {
    const live = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    const target = at('project', ids.destination);
    expect(await can(live.tokenId, 'edit', target)).toBe(true);
    await db
      .update(syncTokens)
      .set({ revokedAt: new Date() })
      .where(eq(syncTokens.id, live.tokenId));
    expect(await can(live.tokenId, 'edit', target)).toBe(false);

    const expired = await makeSyncToken(db, workspaceId, ownerId, [ids.destination], {
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(await can(expired.tokenId, 'edit', target)).toBe(false);
    const unexpired = await makeSyncToken(db, workspaceId, ownerId, [ids.destination], {
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await can(unexpired.tokenId, 'edit', target)).toBe(true);

    const device = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    await db
      .update(syncDevices)
      .set({ revokedAt: new Date(), revokedBy: ownerId })
      .where(eq(syncDevices.id, device.deviceId));
    expect(await can(device.tokenId, 'edit', target)).toBe(false);
  });

  it('never exceeds, or outlives, the access of the person who paired it', async () => {
    const editor = (await makeUser(db)).id;
    await addMember(db, workspaceId, editor, 'editor');
    const { tokenId } = await makeSyncToken(db, workspaceId, editor, [ids.destination]);
    const target = at('project', ids.destination);
    expect(await can(tokenId, 'edit', target)).toBe(true);
    // Demoted to viewer: the Mac may no longer upload either.
    await db
      .update(workspaceMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, editor),
        ),
      );
    expect(await can(tokenId, 'edit', target)).toBe(false);
    // Removed: the device and its tokens go with the membership.
    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, editor),
        ),
      );
    expect(await db.select().from(syncTokens).where(eq(syncTokens.id, tokenId))).toEqual([]);
    expect(await can(tokenId, 'edit', target)).toBe(false);
  });

  it('cannot delete, restore, or purge anything, whatever it may edit', async () => {
    const { tokenId } = await makeSyncToken(db, workspaceId, ownerId, [ids.destination]);
    const context = {
      workspaceId,
      actor: syncTokenSubject(tokenId),
      recoveryWindowDays: 30,
      newId: testId,
    };
    await expect(deleteEntity(db, context, 'project', ids.destination)).rejects.toMatchObject({
      publicCode: 'not_found',
    });
    await expect(restoreEntity(db, context, testId())).rejects.toMatchObject({
      publicCode: 'not_found',
    });
  });

  it('gets nothing from its pairer’s membership on its own', async () => {
    // A token with no destination is not its owner: owning the workspace grants the Mac nothing.
    const { tokenId } = await makeSyncToken(db, workspaceId, ownerId, []);
    for (const action of ACTIONS) {
      expect(await can(tokenId, action, at('project', ids.destination)), action).toBe(false);
    }
  });
});
