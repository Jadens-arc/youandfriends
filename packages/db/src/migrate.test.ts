import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseServerEnv } from '@youandfriends/config';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { unavailableReason } from './__tests__/harness';
import { createDirectClient } from './client';
import { pendingFiles, runMigrations } from './migrate';
import { createScratchDatabase, type ScratchDatabase } from './scratch';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING migration tests: ${reason}`);
}

function migrationsFolder(statements: readonly string[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'yaf-migrate-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });

  const entries = statements.map((statement, index) => {
    const tag = `000${index}_test`;
    writeFileSync(join(folder, `${tag}.sql`), statement);
    return { idx: index, version: '7', when: 1700000000000 + index, tag, breakpoints: true };
  });

  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  return folder;
}

describe('pendingFiles', () => {
  it('lists SQL files in application order', () => {
    const folder = migrationsFolder(['select 1;', 'select 2;', 'select 3;']);
    expect(pendingFiles(folder)).toEqual(['0000_test.sql', '0001_test.sql', '0002_test.sql']);
  });

  it('treats a missing folder as no migrations, not as an error', () => {
    // Task `021` adds the first migration. Until then the folder is legitimately absent, and
    // throwing here would make an empty plan look like a broken one.
    expect(pendingFiles(join(tmpdir(), 'yaf-does-not-exist'))).toEqual([]);
  });

  it('ignores the journal and anything else that is not SQL', () => {
    const folder = migrationsFolder(['select 1;']);
    writeFileSync(join(folder, 'README.md'), 'not a migration');
    expect(pendingFiles(folder)).toEqual(['0000_test.sql']);
  });
});

describeWithDatabase('runMigrations', () => {
  const databases: ScratchDatabase[] = [];

  afterAll(async () => {
    await Promise.all(databases.map((database) => database.drop()));
  });

  /**
   * An *unmigrated* database. Not the shared test harness, which applies the real migrations
   * first — drizzle's ledger would then already hold entry `0000`, and these fixtures' own
   * `0000` would be skipped as already applied. The bug that hid was a migration test that
   * asserted nothing.
   */
  async function freshDatabase(label: string): Promise<ScratchDatabase> {
    const database = await createScratchDatabase(
      parseServerEnv().DATABASE_URL_UNPOOLED ?? '',
      label,
    );
    databases.push(database);
    return database;
  }

  it('applies every migration and reports what it applied', async () => {
    const database = await freshDatabase('run_migrations');
    const env = { ...parseServerEnv(), DATABASE_URL_UNPOOLED: database.url };

    const result = await runMigrations(
      env,
      migrationsFolder([
        'create table song (id int primary key);',
        'alter table song add title text;',
      ]),
    );

    expect(result.applied).toBe(2);
    expect(result.files).toEqual(['0000_test.sql', '0001_test.sql']);

    const probe = createDirectClient(env);
    try {
      const { rows } = await probe.db.execute(
        sql`select column_name from information_schema.columns where table_name = 'song' order by 1`,
      );
      expect(rows).toEqual([{ column_name: 'id' }, { column_name: 'title' }]);
    } finally {
      await probe.close();
    }
  });

  it('is idempotent — a second run applies nothing new', async () => {
    const database = await freshDatabase('run_twice');
    const env = { ...parseServerEnv(), DATABASE_URL_UNPOOLED: database.url };
    const folder = migrationsFolder(['create table once (id int primary key);']);

    await runMigrations(env, folder);
    // The second run must not fail on "relation already exists": a deploy that reruns
    // migrations is normal, and a crash there blocks every subsequent deploy.
    await expect(runMigrations(env, folder)).resolves.toMatchObject({ applied: 1 });
  });

  it('propagates a migration Postgres rejects instead of reporting success', async () => {
    const database = await freshDatabase('run_bad');
    const env = { ...parseServerEnv(), DATABASE_URL_UNPOOLED: database.url };

    await expect(
      runMigrations(env, migrationsFolder(['alter table nope add column x int;'])),
    ).rejects.toThrow(/nope/);
  });

  it('closes its connection, so a migration cannot leave a Neon compute awake', async () => {
    const database = await freshDatabase('run_closes');
    const env = { ...parseServerEnv(), DATABASE_URL_UNPOOLED: database.url };

    await runMigrations(env, migrationsFolder(['create table closed (id int primary key);']));

    const probe = createDirectClient(parseServerEnv());
    try {
      const { rows } = await probe.db.execute(
        sql`select count(*)::int as open from pg_stat_activity where datname = ${database.name}`,
      );
      // Nothing else holds this database open, so the migrator's pool must be gone.
      expect((rows[0] as { open: number }).open).toBe(0);
    } finally {
      await probe.close();
    }
  });
});
