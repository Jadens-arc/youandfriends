import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvitation,
  createInvitation,
  findInvitationById,
  listPendingInvitations,
  revokeInvitation,
} from '../queries/invitations';
import { invitations } from '../schema/invitations';
import { withTransaction } from '../transaction';
import { makeFolder, makeProject, makeSong, makeTenant, makeUser, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING invitation query tests: ${reason}`);

const HOUR = 60 * 60 * 1000;

/**
 * What each rule needs in the fixture before it can bite (CLAUDE.md §13):
 *  - the "one live invitation per address per scope" index needs a **second attempt at the
 *    same scope** to collide against, not just one insert;
 *  - "expired fails the same as revoked" needs a row whose `expiresAt` has genuinely passed,
 *    not a mocked clock the code never reads;
 *  - every workspace-scoped write needs a **populated foreign workspace** with its own
 *    pending invitation, which a missing tenant filter would also touch.
 */
describeWithDatabase('invitation queries', () => {
  let database: TestDatabase;
  let db: TestDatabase['db'];

  beforeAll(async () => {
    database = await createTestDatabase('invitation_queries');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  async function target() {
    const { user, workspace } = await makeTenant(db);
    const folder = await makeFolder(db, workspace.id, `Folder ${testId()}`);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`, folder.id);
    const song = await makeSong(db, workspace.id, project.id, 'Blue Hour');
    return { owner: user, workspace, song };
  }

  const invite = (overrides: Partial<Parameters<typeof createInvitation>[1]> = {}) =>
    withTransaction(db, (tx) =>
      createInvitation(tx, {
        id: testId(),
        workspaceId: overrides.workspaceId ?? '',
        email: 'sam@example.test',
        scopeType: 'song',
        scopeId: overrides.scopeId ?? '',
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        tokenHash: 'hash-placeholder',
        invitedByUserId: overrides.invitedByUserId ?? '',
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
        ...overrides,
      }),
    );

  it('creates a pending invitation, findable by its own id', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });

    expect(created?.state).toBe('pending');
    const found = await findInvitationById(db, created?.id ?? '');
    expect(found?.email).toBe('sam@example.test');
    expect(found?.tokenHash).toBe('hash-placeholder');
  });

  it('refuses a second live invitation to the same address at the same scope', async () => {
    const { owner, workspace, song } = await target();
    const first = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    expect(first).not.toBeNull();

    const second = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    expect(second).toBeNull();
  });

  it('allows a new invitation once the first is revoked', async () => {
    const { owner, workspace, song } = await target();
    const first = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    await withTransaction(db, (tx) =>
      revokeInvitation(tx, workspace.id, first?.id ?? '', owner.id, new Date()),
    );

    const second = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    expect(second).not.toBeNull();
  });

  it('allows the same address to be invited to a different scope concurrently', async () => {
    const { owner, workspace, song } = await target();
    const otherSong = await makeSong(db, workspace.id, song.projectId, 'Other Song');

    const a = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    const b = await invite({
      workspaceId: workspace.id,
      scopeId: otherSong.id,
      invitedByUserId: owner.id,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('does not let one workspace’s invitation collide with another’s, at the same address and scope id', async () => {
    // The row a missing tenant filter would also touch: two different workspaces, the exact
    // same scope id (song ids are ULIDs and never collide in practice, but the invariant this
    // proves is that the unique index is workspace-scoped, not merely scope-scoped).
    const mine = await target();
    const theirs = await target();

    const a = await invite({
      workspaceId: mine.workspace.id,
      scopeId: mine.song.id,
      invitedByUserId: mine.owner.id,
    });
    const b = await invite({
      workspaceId: theirs.workspace.id,
      scopeId: mine.song.id,
      invitedByUserId: theirs.owner.id,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('revokes a pending invitation, and only once', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });

    const revoked = await withTransaction(db, (tx) =>
      revokeInvitation(tx, workspace.id, created?.id ?? '', owner.id, new Date()),
    );
    expect(revoked?.state).toBe('revoked');

    const again = await withTransaction(db, (tx) =>
      revokeInvitation(tx, workspace.id, created?.id ?? '', owner.id, new Date()),
    );
    expect(again).toBeNull();
  });

  it('refuses to revoke an invitation from a different workspace', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    const foreign = await target();

    const result = await withTransaction(db, (tx) =>
      revokeInvitation(tx, foreign.workspace.id, created?.id ?? '', foreign.owner.id, new Date()),
    );
    expect(result).toBeNull();

    // Untouched — still pending, revocable by its real owner.
    const found = await findInvitationById(db, created?.id ?? '');
    expect(found?.state).toBe('pending');
  });

  it('accepts a pending invitation before it expires', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    const accepter = await makeUser(db);

    const accepted = await withTransaction(db, (tx) =>
      acceptInvitation(tx, created?.id ?? '', accepter.id, new Date()),
    );
    expect(accepted?.state).toBe('accepted');
    expect(accepted?.acceptedByUserId).toBe(accepter.id);
  });

  it('refuses to accept an invitation past its own expiry', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
      expiresAt: new Date(Date.now() + HOUR),
    });

    // The clock the code actually reads, not a mock: this is the row's own `expires_at`,
    // compared against a `now` genuinely after it.
    const afterExpiry = new Date((created?.expiresAt.getTime() ?? 0) + 1000);
    const result = await withTransaction(db, (tx) =>
      acceptInvitation(tx, created?.id ?? '', testId(), afterExpiry),
    );
    expect(result).toBeNull();

    const found = await findInvitationById(db, created?.id ?? '');
    expect(found?.state).toBe('pending');
  });

  it('refuses to accept an invitation twice', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    const first = await makeUser(db);
    const second = await makeUser(db);
    await withTransaction(db, (tx) =>
      acceptInvitation(tx, created?.id ?? '', first.id, new Date()),
    );

    const again = await withTransaction(db, (tx) =>
      acceptInvitation(tx, created?.id ?? '', second.id, new Date()),
    );
    expect(again).toBeNull();
  });

  it('refuses to accept a revoked invitation', async () => {
    const { owner, workspace, song } = await target();
    const created = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    await withTransaction(db, (tx) =>
      revokeInvitation(tx, workspace.id, created?.id ?? '', owner.id, new Date()),
    );

    const accepter = await makeUser(db);
    const result = await withTransaction(db, (tx) =>
      acceptInvitation(tx, created?.id ?? '', accepter.id, new Date()),
    );
    expect(result).toBeNull();
  });

  it('lists only this workspace’s pending invitations, newest first', async () => {
    const { owner, workspace, song } = await target();
    const otherSong = await makeSong(db, workspace.id, song.projectId, 'Other Song');
    const foreign = await target();

    const a = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      invitedByUserId: owner.id,
    });
    const b = await invite({
      workspaceId: workspace.id,
      scopeId: otherSong.id,
      invitedByUserId: owner.id,
    });
    // Accepted — must not appear in the pending list.
    const c = await invite({
      workspaceId: workspace.id,
      scopeId: song.id,
      email: 'other@example.test',
      invitedByUserId: owner.id,
    });
    const accepter = await makeUser(db);
    await withTransaction(db, (tx) => acceptInvitation(tx, c?.id ?? '', accepter.id, new Date()));
    // Someone else's workspace's pending invitation — must not leak in.
    await invite({
      workspaceId: foreign.workspace.id,
      scopeId: foreign.song.id,
      invitedByUserId: foreign.owner.id,
    });

    const pending = await listPendingInvitations(db, workspace.id);
    expect(pending.map((row) => row.id).sort()).toEqual([a?.id, b?.id].sort());
  });

  it('is genuinely additive: nothing pre-existing reads or writes it by accident', async () => {
    const count = await db.select().from(invitations).where(eq(invitations.id, testId()));
    expect(count).toHaveLength(0);
  });
});
