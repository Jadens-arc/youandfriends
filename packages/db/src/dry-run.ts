import { parseServerEnv, type ServerEnv } from '@youandfriends/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { CONNECT_TIMEOUT_MS } from './client';
import { MIGRATIONS_FOLDER, pendingFiles } from './migrate';
import { createScratchDatabase } from './scratch';

export type DryRunOutcome =
  | { readonly status: 'passed'; readonly applied: number; readonly database: string }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly error: Error; readonly database: string };

/**
 * Apply every migration to a scratch database, then throw it away.
 *
 * `docs/OPERATIONS.md` §4 requires this before every production migration, and the reason is
 * cheap insurance: a migration that fails halfway leaves production in a state no rollback
 * script anticipated. Failing here costs nothing.
 *
 * A missing `DATABASE_URL_UNPOOLED` **skips, loudly**. A silent pass would be a lie in the
 * build output (CLAUDE.md §7) — the caller reports the skip, and `release-check` prints it.
 */
export async function dryRunMigrations(
  env: ServerEnv = parseServerEnv(),
  folder: string = MIGRATIONS_FOLDER,
): Promise<DryRunOutcome> {
  const adminUrl = env.DATABASE_URL_UNPOOLED;
  if (adminUrl === undefined || adminUrl === '') {
    return {
      status: 'skipped',
      reason: 'DATABASE_URL_UNPOOLED is not set, so there is no server to dry-run against',
    };
  }

  let scratch;
  try {
    scratch = await createScratchDatabase(adminUrl, 'migrate_dry');
  } catch (error) {
    // Unreachable server, wrong credentials, no permission to create a database. This is a
    // real failure of the gate, not a skip: something is configured and it does not work.
    return {
      status: 'failed',
      error: error instanceof Error ? error : new Error(String(error)),
      database: '(not created)',
    };
  }
  const pool = new Pool({
    connectionString: scratch.url,
    max: 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return { status: 'passed', applied: pendingFiles(folder).length, database: scratch.name };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error : new Error(String(error)),
      database: scratch.name,
    };
  } finally {
    await pool.end();
    await scratch.drop();
  }
}
