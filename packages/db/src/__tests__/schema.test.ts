import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NON_TENANT_TABLES } from '../schema/index';
import {
  expectDatabaseError,
  makeFolder,
  makeProject,
  makeSong,
  makeTenant,
  makeUser,
  SQLSTATE,
  testId,
} from './factories';
import { createTestDatabase, unavailableReason, type TestDatabase } from './harness';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING schema tests: ${reason}`);
}

describeWithDatabase('schema', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('schema');
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  /**
   * The tables that actually exist, read from the migrated database rather than from the
   * TypeScript schema. A table added by hand-written SQL in a migration — the folder
   * triggers' tables, were there any — would be invisible to a check that read the schema
   * module, and invisible is exactly how a tenant-owned table loses its `workspace_id`.
   */
  async function liveTables(): Promise<string[]> {
    const { rows } = await database.db.execute(sql`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `);
    return rows.map((row) => (row as { table_name: string }).table_name);
  }

  describe('tenant isolation (THREAT_MODEL T1)', () => {
    it('gives every tenant-owned table a not-null workspace_id', async () => {
      const tables = await liveTables();
      const tenantOwned = tables.filter((name) => !(name in NON_TENANT_TABLES));
      expect(tenantOwned.length).toBeGreaterThan(0);

      const { rows } = await database.db.execute(sql`
        select table_name, is_nullable from information_schema.columns
         where table_schema = 'public' and column_name = 'workspace_id'
      `);
      const byTable = new Map(
        rows.map((row) => {
          const typed = row as { table_name: string; is_nullable: string };
          return [typed.table_name, typed.is_nullable];
        }),
      );

      for (const table of tenantOwned) {
        // A tenant-owned table without this column is a cross-tenant leak waiting for its
        // first query. Adding one and forgetting the column fails here, not in production.
        expect(byTable.get(table), `${table} has no workspace_id`).toBe('NO');
      }
    });

    it('leads an index with workspace_id on every tenant-owned table', async () => {
      const tables = await liveTables();
      const tenantOwned = tables.filter((name) => !(name in NON_TENANT_TABLES));

      const { rows } = await database.db.execute(sql`
        select t.relname as table_name, a.attname as first_column
          from pg_index x
          join pg_class i on i.oid = x.indexrelid
          join pg_class t on t.oid = x.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
         where n.nspname = 'public'
      `);

      const leadingColumns = new Map<string, string[]>();
      for (const row of rows) {
        const typed = row as { table_name: string; first_column: string };
        leadingColumns.set(typed.table_name, [
          ...(leadingColumns.get(typed.table_name) ?? []),
          typed.first_column,
        ]);
      }

      for (const table of tenantOwned) {
        // Second place in a composite index is not a tenant column, it is a column the
        // planner ignores. Every query here is workspace-scoped, so it belongs first.
        expect(
          leadingColumns.get(table) ?? [],
          `${table} has no index leading with workspace_id`,
        ).toContain('workspace_id');
      }
    });

    it('keeps the allow-list honest', async () => {
      const { rows } = await database.db.execute(sql`
        select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'workspace_id'
      `);
      const haveColumn = new Set(rows.map((row) => (row as { table_name: string }).table_name));

      for (const exempt of Object.keys(NON_TENANT_TABLES)) {
        // An entry that gains a workspace_id is no longer an exemption; leaving it listed
        // would silently drop that table out of both checks above.
        expect(haveColumn.has(exempt), `${exempt} is exempt but has workspace_id`).toBe(false);
      }
    });

    it('names a reason for every exemption', () => {
      for (const [table, why] of Object.entries(NON_TENANT_TABLES)) {
        expect(why.length, `${table} is exempt without a reason`).toBeGreaterThan(10);
      }
    });
  });

  describe('identity and tenancy', () => {
    it('maps one row per Clerk identity', async () => {
      const user = await makeUser(database.db);

      await expectDatabaseError(
        database.db.execute(sql`
          insert into users (id, clerk_user_id, email, display_name)
          values (${testId()}, ${user.clerkUserId}, 'other@example.test', 'Impostor')
        `),
        SQLSTATE.uniqueViolation,
        /users_clerk_user_id_key/,
      );
    });

    it('allows one membership per person per workspace, and no more', async () => {
      const { user, workspace } = await makeTenant(database.db);

      await expectDatabaseError(
        database.db.execute(sql`
          insert into workspace_memberships (id, workspace_id, user_id, role)
          values (${testId()}, ${workspace.id}, ${user.id}, 'viewer')
        `),
        SQLSTATE.uniqueViolation,
        /workspace_memberships_workspace_user_key/,
      );
    });

    it('defaults download on and invite off', async () => {
      // `docs/DESIGN.md` §3 makes these independent of role. The defaults are the least
      // surprising ones: a collaborator can take their work with them, and cannot widen the
      // circle without being given that.
      const { membership } = await makeTenant(database.db);
      expect(membership.canDownload).toBe(true);
      expect(membership.canInvite).toBe(false);
    });

    it('refuses to delete a user who still owns a workspace', async () => {
      const { user } = await makeTenant(database.db);

      await expectDatabaseError(
        database.db.execute(sql`delete from users where id = ${user.id}`),
        SQLSTATE.foreignKeyViolation,
        /workspaces_owner_user_id_users_id_fk/,
      );
    });
  });

  describe('content hierarchy', () => {
    it('files a project in a folder, or nowhere at all', async () => {
      const { workspace } = await makeTenant(database.db);
      const folder = await makeFolder(database.db, workspace.id, 'Albums');

      const filed = await makeProject(database.db, workspace.id, 'Blue Hour', folder.id);
      const unfiled = await makeProject(database.db, workspace.id, 'Sketches');

      expect(filed.folderId).toBe(folder.id);
      // An unfiled project is a normal state. Forcing an "Unfiled" folder into existence
      // would put it in the tree, where nobody put it.
      expect(unfiled.folderId).toBeNull();
    });

    it('leaves a project in place when its folder is deleted', async () => {
      const { workspace } = await makeTenant(database.db);
      const folder = await makeFolder(database.db, workspace.id, 'Temporary');
      const project = await makeProject(database.db, workspace.id, 'Kept', folder.id);

      await database.db.execute(sql`delete from folders where id = ${folder.id}`);

      const { rows } = await database.db.execute(
        sql`select folder_id from projects where id = ${project.id}`,
      );
      // Deleting a folder must not delete the work inside it. `on delete set null`, not
      // cascade — originals are sacred, and so is everything that points at them.
      expect(rows).toEqual([{ folder_id: null }]);
    });

    it('starts projects and songs as ideas', async () => {
      const { workspace } = await makeTenant(database.db);
      const project = await makeProject(database.db, workspace.id, 'New');
      const song = await makeSong(database.db, workspace.id, project.id, 'Untitled');

      expect(project.status).toBe('idea');
      expect(song.status).toBe('idea');
    });

    it('leaves current_version_id open until task 026 supplies the table', async () => {
      const { workspace } = await makeTenant(database.db);
      const project = await makeProject(database.db, workspace.id, 'Forward');
      const song = await makeSong(database.db, workspace.id, project.id, 'Pointer');

      expect(song.currentVersionId).toBeNull();
      expect(song.durationMs).toBeNull();

      // A forward reference with no constraint yet — deliberately, to avoid a circular
      // migration. Task `026` adds the foreign key.
      await expect(
        database.db.execute(
          sql`update songs set current_version_id = ${testId()} where id = ${song.id}`,
        ),
      ).resolves.toBeDefined();
    });

    it('deletes a project’s songs with it', async () => {
      const { workspace } = await makeTenant(database.db);
      const project = await makeProject(database.db, workspace.id, 'Doomed');
      await makeSong(database.db, workspace.id, project.id, 'Goes with it');

      await database.db.execute(sql`delete from projects where id = ${project.id}`);

      const { rows } = await database.db.execute(
        sql`select count(*)::int as remaining from songs where project_id = ${project.id}`,
      );
      expect(rows).toEqual([{ remaining: 0 }]);
    });
  });

  describe('favorites', () => {
    it('is idempotent — favouriting twice is favouriting once', async () => {
      const { user, workspace } = await makeTenant(database.db);
      const project = await makeProject(database.db, workspace.id, 'Loved');

      const insert = sql`
        insert into favorites (id, workspace_id, user_id, target_type, target_id)
        values (${testId()}, ${workspace.id}, ${user.id}, 'project', ${project.id})
      `;
      await database.db.execute(insert);

      await expectDatabaseError(
        database.db.execute(sql`
          insert into favorites (id, workspace_id, user_id, target_type, target_id)
          values (${testId()}, ${workspace.id}, ${user.id}, 'project', ${project.id})
        `),
        SQLSTATE.uniqueViolation,
        /favorites_unique_key/,
      );
    });

    it('lets two people favourite the same thing', async () => {
      const { workspace, user } = await makeTenant(database.db);
      const other = await makeUser(database.db);
      await database.db.execute(sql`
        insert into workspace_memberships (id, workspace_id, user_id, role)
        values (${testId()}, ${workspace.id}, ${other.id}, 'editor')
      `);
      const project = await makeProject(database.db, workspace.id, 'Popular');

      for (const person of [user, other]) {
        await expect(
          database.db.execute(sql`
            insert into favorites (id, workspace_id, user_id, target_type, target_id)
            values (${testId()}, ${workspace.id}, ${person.id}, 'project', ${project.id})
          `),
        ).resolves.toBeDefined();
      }
    });

    it('accepts folders, projects, and songs as targets', async () => {
      const { workspace, user } = await makeTenant(database.db);

      for (const target of ['folder', 'project', 'song'] as const) {
        await expect(
          database.db.execute(sql`
            insert into favorites (id, workspace_id, user_id, target_type, target_id)
            values (${testId()}, ${workspace.id}, ${user.id}, ${target}, ${testId()})
          `),
        ).resolves.toBeDefined();
      }
    });
  });

  describe('timestamps', () => {
    it('maintains updated_at in the database, not in application code', async () => {
      const { workspace } = await makeTenant(database.db);
      const project = await makeProject(database.db, workspace.id, 'Touched');

      // A row touched through `psql` during an incident still gets an honest timestamp, and
      // no caller can forget to set it.
      await database.db.execute(sql`update projects set name = 'Renamed' where id = ${project.id}`);

      const { rows } = await database.db.execute(
        sql`select updated_at > created_at as advanced from projects where id = ${project.id}`,
      );
      expect(rows).toEqual([{ advanced: true }]);
    });
  });
});
