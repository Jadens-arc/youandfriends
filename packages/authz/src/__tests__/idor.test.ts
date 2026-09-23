import { type WorkspaceId } from '@youandfriends/contracts';
import {
  ensureScopeLimitedMembership,
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
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthorizer } from '../authorizer';
import { scopedQuery } from '../scoped-query';
import { memberSubject, shareLinkSubject, syncTokenSubject, type Target } from '../subjects';
import { caught, expectIndistinguishable, expectNotFoundShape } from './helpers';
import {
  liveResources,
  NON_TENANT_TABLES,
  pendingResources,
  SENSITIVE_RESOURCES,
} from './resources';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING IDOR tests: ${reason}`);
}

/**
 * Cross-workspace access, for every sensitive resource class.
 *
 * `docs/THREAT_MODEL.md` T1: a request naming another tenant's id must be answered as though
 * the thing does not exist. Not refused — *unknown*. Every assertion here is on the shape of
 * the refusal, because a test that only checks "not allowed" passes against a 403 that
 * confirms existence.
 */
describeWithDatabase('cross-workspace access', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('idor');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  /** Two unrelated tenants, and one full tree inside the second. */
  async function twoTenants() {
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);
    const folder = await makeFolder(db, theirs.workspace.id, `Theirs ${testId()}`);
    const project = await makeProject(db, theirs.workspace.id, `Theirs ${testId()}`, folder.id);
    const song = await makeSong(db, theirs.workspace.id, project.id, 'Unreleased');

    return { mine, theirs, folder, project, song };
  }

  describe('the registry is complete', () => {
    it('lists every tenant-owned table that exists', async () => {
      const { rows } = await db.execute(sql`
        select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
         order by table_name
      `);
      const live = rows
        .map((row) => (row as { table_name: string }).table_name)
        .filter((name) => !NON_TENANT_TABLES.includes(name as never));

      const registered = new Set(liveResources.map((resource) => resource.name));
      const missing = live.filter((name) => !registered.has(name));

      // The cheap path — ship the table, write the test later — is closed here. A new
      // tenant-owned table fails this until it is registered, and registering it generates
      // the whole negative-case set below.
      expect(missing, `unregistered tenant-owned tables: ${missing.join(', ')}`).toEqual([]);
    });

    it('does not claim a pending class already exists', async () => {
      const { rows } = await db.execute(sql`
        select table_name from information_schema.tables where table_schema = 'public'
      `);
      const existing = new Set(rows.map((row) => (row as { table_name: string }).table_name));

      for (const resource of pendingResources) {
        // When the table lands, this fails — which is the prompt to convert the entry to
        // `live` rather than to delete it.
        expect(
          existing.has(resource.tableName),
          `${resource.name} now exists; convert its registry entry to live (task ${resource.task})`,
        ).toBe(false);
      }
    });

    it('names a task and a reason for every pending class', () => {
      for (const resource of pendingResources) {
        expect(resource.task).toMatch(/^\d{3}$/);
        expect(resource.why.length).toBeGreaterThan(20);
      }
    });

    it('covers every class task 023 names', () => {
      const named = [
        'folders',
        'projects',
        'songs',
        'assets',
        'asset_versions',
        'lyrics_documents',
        'comments',
        'notifications',
        'audit_events',
        'upload_sessions',
        'share_links',
        'sync_tokens',
      ];
      const registered = new Set(SENSITIVE_RESOURCES.map((resource) => resource.name));
      for (const name of named) expect(registered.has(name), `${name} unregistered`).toBe(true);
    });
  });

  describe('a scoped handle cannot read another tenant', () => {
    const scopedReadable = liveResources.filter(
      (resource): resource is typeof resource & { table: NonNullable<typeof resource.table> } =>
        resource.table !== null,
    );

    // Generated per resource class, so a new class inherits the whole set by registering
    // rather than by someone writing these cases again.
    //
    // **Each case seeds a real row in the other workspace first.** Without that these were
    // vacuous: an empty foreign workspace leaks nothing whether or not the tenant filter
    // works, and deleting the filter from `scopedQuery` would not have failed one of them.
    // A security review caught it.
    it.each(scopedReadable)('$name', async (resource) => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      await resource.seed(db, theirs.workspace.id);

      const scoped = await scopedQuery(
        db,
        memberSubject(mine.user.id as never),
        mine.workspace.id as WorkspaceId,
      );

      const rows = await scoped.many(resource.table);
      const foreign = rows.filter(
        (row) => (row as { workspaceId?: string }).workspaceId === theirs.workspace.id,
      );

      expect(foreign, `${resource.name} leaked rows from another workspace`).toEqual([]);
    });

    it.each(scopedReadable)('$name — the seed really put a row there', async (resource) => {
      // Guards the guard: a seeder that silently inserted nothing would make the case above
      // vacuous again, and nothing would say so.
      const theirs = await makeTenant(db);
      await resource.seed(db, theirs.workspace.id);

      const scoped = await scopedQuery(
        db,
        memberSubject(theirs.user.id as never),
        theirs.workspace.id as WorkspaceId,
      );

      expect(
        (await scoped.many(resource.table, undefined, { lifecycle: 'all' })).length,
        `${resource.name} seeder created no row`,
      ).toBeGreaterThan(0);
    });

    it.each(scopedReadable)('$name, asked for by id', async (resource) => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      await resource.seed(db, theirs.workspace.id);

      const scoped = await scopedQuery(
        db,
        memberSubject(mine.user.id as never),
        mine.workspace.id as WorkspaceId,
      );

      // The caller's own condition narrows the tenant filter; it cannot reach past it.
      const where = sql`${resource.table}.workspace_id = ${theirs.workspace.id}`;
      expect(await scoped.count(resource.table, where)).toBe(0);
      expect(await scoped.one(resource.table, where)).toBeNull();
    });

    it('a scope-limited collaborator cannot open one at all, even holding a real membership row', async () => {
      // The row that makes this bite: `ensureScopeLimitedMembership` (task `032`) really does
      // insert a `workspace_memberships` row — before `scoped-query.ts` filtered on
      // `role IS NOT NULL`, "a membership row exists" and "may hold a workspace-wide handle"
      // were the same fact, and this task's own nullable-role column made them different
      // without this file ever being told (found in security review). A workspace-wide handle
      // (every table filtered by `workspace_id` alone) is exactly the access a scope-limited
      // invitation exists to withhold.
      const { workspace } = await makeTenant(db);
      const collaborator = await makeUser(db);
      await withTransaction(db, (tx) =>
        ensureScopeLimitedMembership(tx, workspace.id, collaborator.id, testId()),
      );

      expectNotFoundShape(
        await caught(
          scopedQuery(db, memberSubject(collaborator.id as never), workspace.id as WorkspaceId),
        ),
      );
    });
  });

  describe('a targetable resource refuses 404-shaped', () => {
    const targetable = liveResources.filter(
      (
        resource,
      ): resource is typeof resource & { scopeType: NonNullable<typeof resource.scopeType> } =>
        resource.scopeType !== null,
    );

    it.each(targetable)('$name', async (resource) => {
      const { mine, folder, project, song } = await twoTenants();
      const scopeId = { folder: folder.id, project: project.id, song: song.id }[resource.scopeType];

      const target: Target = {
        workspaceId: mine.workspace.id as WorkspaceId,
        scopeType: resource.scopeType,
        scopeId,
      };

      const authorizer = createAuthorizer(db);
      const subject = memberSubject(mine.user.id as never);

      const refused = await caught(authorizer.assertCan(subject, 'view', target));
      const missing = await caught(
        authorizer.assertCan(subject, 'view', { ...target, scopeId: testId() }),
      );

      // "Exists but is not yours" and "does not exist" must be the same answer. Comparing
      // them catches a difference nobody thought to assert on.
      expectIndistinguishable(refused, missing);
    });

    it.each(targetable)(
      '$name, even holding a grant written against the real id',
      async (resource) => {
        const { mine, theirs, folder, project, song } = await twoTenants();
        const scopeId = { folder: folder.id, project: project.id, song: song.id }[
          resource.scopeType
        ];

        await db.execute(sql`
        insert into permission_grants
          (id, workspace_id, scope_type, scope_id, subject_kind, subject_id, role)
        values (${testId()}, ${theirs.workspace.id}, ${resource.scopeType}, ${scopeId},
                'member', ${mine.user.id}, 'owner')
      `);

        // A grant in the *other* workspace does not make the resource reachable through mine:
        // the chain is loaded workspace-scoped, so the target is not found at all.
        const access = await createAuthorizer(db).resolveAccess(
          memberSubject(mine.user.id as never),
          {
            workspaceId: mine.workspace.id as WorkspaceId,
            scopeType: resource.scopeType,
            scopeId,
          },
        );

        expect(access.role).toBeNull();
      },
    );
  });

  describe('opening a handle on someone else’s workspace', () => {
    it('is refused 404-shaped', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);

      const error = await caught(
        scopedQuery(db, memberSubject(mine.user.id as never), theirs.workspace.id as WorkspaceId),
      );

      expectNotFoundShape(error);
    });

    it('looks the same as a workspace that does not exist', async () => {
      const mine = await makeTenant(db);
      const theirs = await makeTenant(db);
      const subject = memberSubject(mine.user.id as never);

      const refused = await caught(scopedQuery(db, subject, theirs.workspace.id as WorkspaceId));
      const missing = await caught(scopedQuery(db, subject, testId() as WorkspaceId));

      expectIndistinguishable(refused, missing);
    });
  });
});

/**
 * The sync-token subject.
 *
 * The token itself arrives in task `110`; the *subject* exists now, and these are the
 * properties that must hold before it can be issued. Writing them later would mean writing
 * them after the code that assumed otherwise.
 */
describeWithDatabase('sync token subject', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('idor_sync');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('cannot open a workspace-scoped handle at all', async () => {
    const mine = await makeTenant(db);

    // A token is authorized against what it was issued for, never against a workspace. A
    // workspace-wide handle would make a folder sync a key to everything.
    expectNotFoundShape(
      await caught(scopedQuery(db, syncTokenSubject(testId()), mine.workspace.id as WorkspaceId)),
    );
  });

  it('gets nothing from a membership held by the person who issued it', async () => {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`);
    const song = await makeSong(db, workspace.id, project.id, 'Theirs');

    // The issuer is a workspace owner. The token is not.
    const access = await createAuthorizer(db).resolveAccess(syncTokenSubject(user.id), {
      workspaceId: workspace.id as WorkspaceId,
      scopeType: 'song',
      scopeId: song.id,
    });

    expect(access.role).toBeNull();
  });

  it('reads only the scopes it was explicitly granted', async () => {
    const { workspace } = await makeTenant(db);
    const granted = await makeFolder(db, workspace.id, `Synced ${testId()}`);
    const other = await makeFolder(db, workspace.id, `Private ${testId()}`);
    const tokenId = testId();

    await db.execute(sql`
      insert into permission_grants
        (id, workspace_id, scope_type, scope_id, subject_kind, subject_id, role)
      values (${testId()}, ${workspace.id}, 'folder', ${granted.id}, 'sync_token', ${tokenId}, 'editor')
    `);

    const authorizer = createAuthorizer(db);
    const subject = syncTokenSubject(tokenId);
    const at = (scopeId: string): Target => ({
      workspaceId: workspace.id as WorkspaceId,
      scopeType: 'folder',
      scopeId,
    });

    expect((await authorizer.resolveAccess(subject, at(granted.id))).role).toBe('editor');
    // Its allow-list is its grants. A sibling folder is outside it.
    expect((await authorizer.resolveAccess(subject, at(other.id))).role).toBeNull();
  });

  it('cannot touch another workspace', async () => {
    const mine = await makeTenant(db);
    const theirs = await makeTenant(db);
    const theirFolder = await makeFolder(db, theirs.workspace.id, `Theirs ${testId()}`);
    const tokenId = testId();

    await db.execute(sql`
      insert into permission_grants
        (id, workspace_id, scope_type, scope_id, subject_kind, subject_id, role)
      values (${testId()}, ${mine.workspace.id}, 'folder', ${theirFolder.id}, 'sync_token', ${tokenId}, 'owner')
    `);

    const access = await createAuthorizer(db).resolveAccess(syncTokenSubject(tokenId), {
      workspaceId: mine.workspace.id as WorkspaceId,
      scopeType: 'folder',
      scopeId: theirFolder.id,
    });

    expect(access.role).toBeNull();
  });
});

describeWithDatabase('share-link subject', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('idor_share');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('never inherits membership, even when the link was made by an owner', async () => {
    const { user, workspace } = await makeTenant(db);
    const project = await makeProject(db, workspace.id, `Project ${testId()}`);
    const song = await makeSong(db, workspace.id, project.id, 'Shared');

    const access = await createAuthorizer(db).resolveAccess(shareLinkSubject(user.id), {
      workspaceId: workspace.id as WorkspaceId,
      scopeType: 'song',
      scopeId: song.id,
    });

    // A link to one song must never become a key to the workspace (THREAT_MODEL T5).
    expect(access.role).toBeNull();
  });

  it('cannot open a workspace-scoped handle', async () => {
    const mine = await makeTenant(db);
    expectNotFoundShape(
      await caught(scopedQuery(db, shareLinkSubject(testId()), mine.workspace.id as WorkspaceId)),
    );
  });
});
