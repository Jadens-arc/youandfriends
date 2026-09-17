import type { UserId, WorkspaceId } from '@youandfriends/contracts';
import type { DirectDatabase } from '@youandfriends/db';
import {
  assertSeedAllowed,
  deterministicId,
  reset,
  seed,
  SEED_GRANTS,
  SEED_USERS,
  SEED_WORKSPACE_ID,
} from '@youandfriends/db/seed';
import {
  createTestDatabase,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthorizer } from '../authorizer';
import { memberSubject, type Target } from '../subjects';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING seeded-grant resolution tests: ${reason}`);
}

/**
 * What the seeded workspace actually resolves to.
 *
 * Task `027`'s seed exists so that "permission behaviour is visible without setting it up", and
 * `packages/db/src/seed/data.ts` says in prose what each grant is supposed to demonstrate. Prose
 * is not a check. Without this file, a resolver that dropped scoped grants entirely — or one
 * that ignored denies — would produce a seeded workspace that still looked right to anyone
 * reading it, because every collaborator also has a workspace-wide membership underneath.
 *
 * This lives in `packages/authz` rather than beside the seed because the dependency runs
 * authz → db. It is the only place the two can meet.
 *
 * The expectations below are written from `docs/DESIGN.md` §3 and the seed's stated intent, not
 * from reading `resolve.ts`. Task `023` enumerates the rules; this asserts that this particular
 * data exercises them.
 */
describeWithDatabase('the seeded grants resolve the way the seed says they do', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  const permit = assertSeedAllowed({
    NODE_ENV: 'test',
    DATABASE_URL_UNPOOLED: ['postgres', '://', 'localhost', '/yaf'].join(''),
  });

  const workspaceId = SEED_WORKSPACE_ID as WorkspaceId;
  const song = (key: string): Target => ({
    workspaceId,
    scopeType: 'song',
    scopeId: deterministicId(`song:${key}`),
  });
  const member = (key: string) => memberSubject(deterministicId(`user:${key}`) as UserId);

  beforeAll(async () => {
    database = await createTestDatabase('seeded-grants');
    db = database.db;
    await seed(db, permit);
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('applies a folder grant to a song inside that folder, and not outside it', async () => {
    const authz = createAuthorizer(db);

    // Tom's membership is editor with no download. His grant on the Blue Hour folder adds
    // download. So the folder grant is observable precisely as: he may download inside, and
    // may not outside.
    const inside = await authz.resolveAccess(member('tom'), song('blue-hour-1'));
    const outside = await authz.resolveAccess(member('tom'), song('second-sleep-2'));

    expect(inside.role).toBe('editor');
    expect(inside.canDownload).toBe(true);

    expect(outside.role).toBe('editor');
    expect(outside.canDownload).toBe(false);
  }, 60_000);

  it('lets a song-level deny beat both the folder grant and the membership', async () => {
    const authz = createAuthorizer(db);

    // The case task `027` names explicitly. `blue-hour-2` sits inside the granted folder and
    // its grantee is a workspace editor, so a deny that failed to win would be invisible: the
    // answer would simply fall through to editor and look correct.
    const denied = await authz.resolveAccess(member('tom'), song('blue-hour-2'));
    expect(denied.role).toBeNull();
    expect(denied.canDownload).toBe(false);

    // Its siblings in the same folder are unaffected — a deny that leaked upward would take
    // the whole folder with it.
    for (const key of ['blue-hour-1', 'blue-hour-3']) {
      expect((await authz.resolveAccess(member('tom'), song(key))).role, key).toBe('editor');
    }

    // And it is scoped to the subject: the owner still sees the song.
    expect((await authz.resolveAccess(member('avery'), song('blue-hour-2'))).role).toBe('owner');
  }, 60_000);

  it('raises a capability without raising the role', async () => {
    const authz = createAuthorizer(db);

    // `docs/DESIGN.md` §3: download resolves independently of role. Priya is a viewer
    // everywhere and may download only inside Blue Hour.
    const granted = await authz.resolveAccess(member('priya'), song('blue-hour-1'));
    expect(granted.role).toBe('viewer');
    expect(granted.canDownload).toBe(true);

    const elsewhere = await authz.resolveAccess(member('priya'), song('second-sleep-2'));
    expect(elsewhere.role).toBe('viewer');
    expect(elsewhere.canDownload).toBe(false);
  }, 60_000);

  it('raises a role on one song only', async () => {
    const authz = createAuthorizer(db);

    // Sam is a commenter workspace-wide and an editor on exactly one song.
    expect((await authz.resolveAccess(member('sam'), song('second-sleep-1'))).role).toBe('editor');
    expect((await authz.resolveAccess(member('sam'), song('second-sleep-2'))).role).toBe(
      'commenter',
    );
  }, 60_000);

  it('gives every seeded grant a visible effect somewhere', async () => {
    const authz = createAuthorizer(db);

    // The property behind the four cases above, stated once over the data rather than the
    // examples: for each grant, the access at its scope differs from the grantee's baseline.
    // A grant that restates its membership resolves identically to no grant at all, and a seed
    // full of those demonstrates nothing while appearing to demonstrate everything.
    for (const grant of SEED_GRANTS) {
      const membership = SEED_USERS.find((user) => user.key === grant.userKey);
      if (!membership) throw new Error(`no membership for ${grant.userKey}`);

      const at = await authz.resolveAccess(member(grant.userKey), {
        workspaceId,
        scopeType: grant.scopeType,
        scopeId: deterministicId(`${grant.scopeType}:${grant.scopeKey}`),
      });

      const differs = at.role !== membership.role || at.canDownload !== membership.canDownload;
      expect(differs, `${grant.key} resolves to the same access as no grant at all`).toBe(true);
    }
  }, 60_000);

  it('leaves nothing behind that a re-seed would trip over', async () => {
    // `reset` then `seed` is what a developer does between branches; a leftover row would
    // surface here as a conflict rather than three days later.
    await reset(db, permit);
    await seed(db, permit);

    const authz = createAuthorizer(db);
    expect((await authz.resolveAccess(member('tom'), song('blue-hour-2'))).role).toBeNull();
  }, 60_000);
});
