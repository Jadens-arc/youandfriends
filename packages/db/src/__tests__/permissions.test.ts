import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deleteAllGrantsForMember,
  deleteGrant,
  findGrant,
  grantCountsByMember,
  grantsForMember,
  upsertGrant,
} from '../queries/permissions';
import { permissionGrants } from '../schema/permissions';
import { withTransaction } from '../transaction';
import { makeFolder, makeProject, makeSong, makeTenant, makeUser, testId } from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING permission grant query tests: ${reason}`);

/**
 * What each rule needs (CLAUDE.md §13):
 *  - "updates rather than collides" needs an existing grant at the **exact same** scope to
 *    upsert into — one insert alone never exercises the conflict branch;
 *  - "clears every grant" needs a subject holding grants at **more than one** scope, or a
 *    query that only cleared the first one would still pass;
 *  - every workspace-scoped write needs a **populated foreign workspace** holding the same
 *    subject's grant on a same-shaped scope, so a missing tenant filter has something to leak.
 */
describeWithDatabase('permission grant queries', () => {
  let database: TestDatabase;
  let db: TestDatabase['db'];

  beforeAll(async () => {
    database = await createTestDatabase('permission_queries');
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
    return { owner, workspace, folder, project, song };
  }

  it('creates a grant, reporting that it created one', async () => {
    const { owner, workspace, song } = await tree();
    const subject = await makeUser(db);

    const { grant, created } = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    expect(created).toBe(true);
    expect(grant.role).toBe('viewer');

    const found = await findGrant(db, workspace.id, 'song', song.id, subject.id);
    expect(found?.id).toBe(grant.id);
  });

  it('updates the existing grant on a second call at the same scope, reporting that it did not create', async () => {
    const { owner, workspace, song } = await tree();
    const subject = await makeUser(db);

    const first = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    const second = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'editor',
        canDownload: true,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    expect(second.created).toBe(false);
    // The same row, updated in place — not a second grant beside the first.
    expect(second.grant.id).toBe(first.grant.id);
    expect(second.grant.role).toBe('editor');
    expect(second.grant.canDownload).toBe(true);

    const rows = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.subjectId, subject.id));
    expect(rows).toHaveLength(1);
  });

  it('keeps the original createdByUserId across an update', async () => {
    const { owner, workspace, song } = await tree();
    const subject = await makeUser(db);
    const secondInviter = await makeUser(db);

    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );
    const { grant } = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'editor',
        canDownload: false,
        canInvite: false,
        createdByUserId: secondInviter.id,
      }),
    );

    expect(grant.createdByUserId).toBe(owner.id);
  });

  it('does not update a grant at a different scope, or in a different workspace', async () => {
    const { owner, workspace, song, project } = await tree();
    const subject = await makeUser(db);
    const foreign = await tree();

    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    // Same subject, same workspace, a different scope in the same tree — must be its own row.
    const atProject = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'project',
        scopeId: project.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'editor',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );
    expect(atProject.created).toBe(true);

    // Same subject id, same scope type, the *other* workspace's song — a missing tenant
    // filter would resolve this to the first grant above and silently update it instead.
    const inForeignWorkspace = await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: foreign.workspace.id,
        scopeType: 'song',
        scopeId: foreign.song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'commenter',
        canDownload: false,
        canInvite: false,
        createdByUserId: foreign.owner.id,
      }),
    );
    expect(inForeignWorkspace.created).toBe(true);

    const original = await findGrant(db, workspace.id, 'song', song.id, subject.id);
    expect(original?.role).toBe('viewer');
  });

  it('lists every grant a subject holds, across scopes, and no one else’s', async () => {
    const { owner, workspace, song, project } = await tree();
    const subject = await makeUser(db);
    const bystander = await makeUser(db);

    for (const scope of [
      { scopeType: 'song' as const, scopeId: song.id },
      { scopeType: 'project' as const, scopeId: project.id },
    ]) {
      await withTransaction(db, (tx) =>
        upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          subjectKind: 'member',
          subjectId: subject.id,
          role: 'viewer',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
          ...scope,
        }),
      );
    }
    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: bystander.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    const grants = await grantsForMember(db, workspace.id, subject.id);
    expect(grants).toHaveLength(2);
    expect(grants.map((g) => g.subjectId)).toEqual([subject.id, subject.id]);
  });

  it('removes one grant and leaves the rest', async () => {
    const { owner, workspace, song, project } = await tree();
    const subject = await makeUser(db);

    for (const scope of [
      { scopeType: 'song' as const, scopeId: song.id },
      { scopeType: 'project' as const, scopeId: project.id },
    ]) {
      await withTransaction(db, (tx) =>
        upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          subjectKind: 'member',
          subjectId: subject.id,
          role: 'viewer',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
          ...scope,
        }),
      );
    }

    const removed = await withTransaction(db, (tx) =>
      deleteGrant(tx, workspace.id, 'song', song.id, subject.id),
    );
    expect(removed?.scopeType).toBe('song');

    expect(await findGrant(db, workspace.id, 'song', song.id, subject.id)).toBeNull();
    const remaining = await grantsForMember(db, workspace.id, subject.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.scopeType).toBe('project');
  });

  it('removes every grant a subject holds in a workspace, and reports how many', async () => {
    const { owner, workspace, song, project } = await tree();
    const subject = await makeUser(db);
    const foreign = await tree();

    for (const scope of [
      { scopeType: 'song' as const, scopeId: song.id },
      { scopeType: 'project' as const, scopeId: project.id },
    ]) {
      await withTransaction(db, (tx) =>
        upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          subjectKind: 'member',
          subjectId: subject.id,
          role: 'viewer',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
          ...scope,
        }),
      );
    }
    // The row a missing tenant filter would also delete.
    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: foreign.workspace.id,
        scopeType: 'song',
        scopeId: foreign.song.id,
        subjectKind: 'member',
        subjectId: subject.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: foreign.owner.id,
      }),
    );

    const removedCount = await withTransaction(db, (tx) =>
      deleteAllGrantsForMember(tx, workspace.id, subject.id),
    );
    expect(removedCount).toBe(2);

    expect(await grantsForMember(db, workspace.id, subject.id)).toHaveLength(0);
    expect(await grantsForMember(db, foreign.workspace.id, subject.id)).toHaveLength(1);
  });

  it('finds the right subject’s grant when two subjects share a scope', async () => {
    // The row that makes a dropped `subjectId` filter visible: without it, `findGrant` has two
    // candidate rows instead of one, and returns whichever the planner hands back first —
    // right or wrong depending on nothing this test controls.
    const { owner, workspace, song } = await tree();
    const alice = await makeUser(db);
    const bob = await makeUser(db);

    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: alice.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );
    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: bob.id,
        role: 'editor',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    expect((await findGrant(db, workspace.id, 'song', song.id, alice.id))?.role).toBe('viewer');
    expect((await findGrant(db, workspace.id, 'song', song.id, bob.id))?.role).toBe('editor');
  });

  it('never touches a grant that is not this subject’s, even at the same scope', async () => {
    const { owner, workspace, song } = await tree();
    const subject = await makeUser(db);
    const other = await makeUser(db);

    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: other.id,
        role: 'editor',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );

    const removed = await withTransaction(db, (tx) =>
      deleteGrant(tx, workspace.id, 'song', song.id, subject.id),
    );
    expect(removed).toBeNull();

    expect(await findGrant(db, workspace.id, 'song', song.id, other.id)).not.toBeNull();
  });

  it('counts grants per member, leaving out members with none and other workspaces’ grants', async () => {
    // The rows that make each rule bite: `twoScopes` needs grants at two different scopes to
    // prove this counts rather than just detects a row; `zeroGrants` needs to hold none, so an
    // absent-means-zero query and a broken join that fabricates a zero-row both look the same
    // unless the map is checked for the key's absence, not just its value; the foreign
    // workspace needs its own populated grant, so a dropped tenant filter would inflate a count.
    const { owner, workspace, song, project } = await tree();
    const twoScopes = await makeUser(db);
    const oneScope = await makeUser(db);
    const zeroGrants = await makeUser(db);
    const foreign = await tree();

    for (const scope of [
      { scopeType: 'song' as const, scopeId: song.id },
      { scopeType: 'project' as const, scopeId: project.id },
    ]) {
      await withTransaction(db, (tx) =>
        upsertGrant(tx, {
          id: testId(),
          workspaceId: workspace.id,
          subjectKind: 'member',
          subjectId: twoScopes.id,
          role: 'viewer',
          canDownload: false,
          canInvite: false,
          createdByUserId: owner.id,
          ...scope,
        }),
      );
    }
    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: workspace.id,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: oneScope.id,
        role: 'commenter',
        canDownload: false,
        canInvite: false,
        createdByUserId: owner.id,
      }),
    );
    // Same-shaped grant, but the other workspace — must not inflate this workspace's counts.
    await withTransaction(db, (tx) =>
      upsertGrant(tx, {
        id: testId(),
        workspaceId: foreign.workspace.id,
        scopeType: 'song',
        scopeId: foreign.song.id,
        subjectKind: 'member',
        subjectId: twoScopes.id,
        role: 'viewer',
        canDownload: false,
        canInvite: false,
        createdByUserId: foreign.owner.id,
      }),
    );

    const counts = await grantCountsByMember(db, workspace.id);
    expect(counts.get(twoScopes.id)).toBe(2);
    expect(counts.get(oneScope.id)).toBe(1);
    expect(counts.has(zeroGrants.id)).toBe(false);
    expect(counts.get(foreign.owner.id)).toBeUndefined();
  });
});
