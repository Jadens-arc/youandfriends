import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseServerEnv } from '@youandfriends/config';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestDatabase, unavailableReason, type TestDatabase } from './__tests__/harness';
import { dryRunMigrations } from './dry-run';
import { createScratchDatabase } from './scratch';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING migration dry-run tests: ${reason}`);
}

/** A migrations folder on disk, with the journal drizzle's migrator expects. */
function migrationsFolder(statements: readonly string[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'yaf-migrations-'));
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

describe('dryRunMigrations', () => {
  it('fails rather than skips when a configured server cannot be reached', async () => {
    // Skipping here would hide a misconfiguration behind a green build. Something is
    // configured and it does not work, which is a failure of the gate.
    const unreachable = ['postgresql:', '', 'nobody@127.0.0.1:1/none'].join('/');
    const outcome = await dryRunMigrations({
      ...parseServerEnv({ NODE_ENV: 'test' }),
      DATABASE_URL_UNPOOLED: unreachable,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.database).toBe('(not created)');
  }, 30_000);

  it('skips loudly when no database is configured, rather than passing quietly', async () => {
    const outcome = await dryRunMigrations(parseServerEnv({ NODE_ENV: 'test' }));

    expect(outcome.status).toBe('skipped');
    expect(outcome).toHaveProperty('reason', expect.stringContaining('DATABASE_URL_UNPOOLED'));
  });
});

describeWithDatabase('dryRunMigrations against a real server', () => {
  const created: string[] = [];
  const databases: TestDatabase[] = [];

  afterAll(async () => {
    await Promise.all(databases.map((database) => database.teardown()));
  });

  it('passes on a migration Postgres accepts', async () => {
    const outcome = await dryRunMigrations(
      parseServerEnv(),
      migrationsFolder(['create table dry_ok (id int primary key);']),
    );

    expect(outcome.status).toBe('passed');
    if (outcome.status === 'passed') created.push(outcome.database);
  });

  it('fails on a migration Postgres rejects — the whole point of the gate', async () => {
    const outcome = await dryRunMigrations(
      parseServerEnv(),
      migrationsFolder([
        'create table dry_bad (id int primary key);',
        'alter table no_such_table add column oops int;',
      ]),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/no_such_table/);
      created.push(outcome.database);
    }
  });

  it('drops its scratch database whether it passed or failed', async () => {
    // A leaked database on Neon keeps storage and a compute alive, which costs money and
    // eventually collides with the next run's name.
    const client = new Client({ connectionString: parseServerEnv().DATABASE_URL_UNPOOLED });
    await client.connect();
    try {
      for (const name of created) {
        const { rows } = await client.query('select 1 from pg_database where datname = $1', [name]);
        expect(rows).toEqual([]);
      }
    } finally {
      await client.end();
    }
    expect(created.length).toBe(2);
  });

  it('leaves the database it ran against untouched', async () => {
    const database = await createTestDatabase('dry_run_isolation');
    databases.push(database);

    await database.db.execute(sql`create table survivor (id int primary key)`);
    await dryRunMigrations(
      parseServerEnv(),
      migrationsFolder(['create table elsewhere (id int);']),
    );

    const { rows } = await database.db.execute(
      sql`select to_regclass('public.survivor') is not null as present`,
    );
    expect(rows).toEqual([{ present: true }]);
  });
});

describeWithDatabase('the test harness itself', () => {
  it('gives each caller its own database, torn down afterwards', async () => {
    const adminUrl = parseServerEnv().DATABASE_URL_UNPOOLED ?? '';
    const first = await createScratchDatabase(adminUrl, 'harness_a');
    const second = await createScratchDatabase(adminUrl, 'harness_b');

    expect(first.name).not.toBe(second.name);

    await first.drop();
    await second.drop();

    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const { rows } = await client.query(
        'select datname from pg_database where datname = any($1)',
        [[first.name, second.name]],
      );
      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('tolerates a second drop, so a failed test does not cascade into teardown noise', async () => {
    const scratch = await createScratchDatabase(
      parseServerEnv().DATABASE_URL_UNPOOLED ?? '',
      'twice',
    );
    await scratch.drop();
    await expect(scratch.drop()).resolves.toBeUndefined();
  });
});
