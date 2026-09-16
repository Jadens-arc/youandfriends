import { parseServerEnv } from '@youandfriends/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { CONNECT_TIMEOUT_MS, type DirectDatabase } from '../client';
import { MIGRATIONS_FOLDER } from '../migrate';
import { createScratchDatabase } from '../scratch';

/**
 * A real Postgres database, per test file, torn down afterwards.
 *
 * Per *file*, not per test: a database costs a round trip to create, and tests inside one
 * file are written by one author who can see them all. Across files nobody can, which is
 * where shared state turns into a test that passes alone and fails in CI.
 *
 * Nothing here is mocked. A fake that accepts every statement would pass a migration that
 * Postgres rejects, which is the one thing this harness exists to catch.
 */
export interface TestDatabase {
  readonly db: DirectDatabase;
  readonly url: string;
  readonly name: string;
  teardown(): Promise<void>;
}

/** Why the harness cannot run, or `null` when it can. */
export function unavailableReason(): string | null {
  const url = parseServerEnv().DATABASE_URL_UNPOOLED;
  if (url === undefined || url === '') {
    return 'DATABASE_URL_UNPOOLED is not set — no Postgres server to create a test database on';
  }
  return null;
}

export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const env = parseServerEnv();
  const adminUrl = env.DATABASE_URL_UNPOOLED;
  if (adminUrl === undefined || adminUrl === '') {
    // Callers are expected to check `unavailableReason` and skip loudly. Reaching here means
    // they did not, and a confusing connection error later is worse than this.
    throw new Error('createTestDatabase requires DATABASE_URL_UNPOOLED');
  }

  const scratch = await createScratchDatabase(adminUrl, label);
  const pool = new Pool({
    connectionString: scratch.url,
    max: 2,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  const db = drizzle(pool) as unknown as DirectDatabase;

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    url: scratch.url,
    name: scratch.name,
    async teardown() {
      await pool.end();
      await scratch.drop();
    },
  };
}
