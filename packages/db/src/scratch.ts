import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { CONNECT_TIMEOUT_MS } from './client';

/**
 * Throwaway databases, for the test harness and the migration dry run.
 *
 * Both need the same thing: a real Postgres database that starts empty, takes the migrations,
 * and is gone afterwards. Sharing one database across test files produces tests that pass
 * alone and fail together — worse than no test, because the failure arrives attached to
 * whichever file happened to run second.
 *
 * `CREATE DATABASE` rather than a schema-per-test: a schema does not isolate extensions,
 * types, or anything a migration creates outside `public`, and a migration is exactly what is
 * being exercised here.
 */

/** A name Postgres accepts, unique per caller, and obviously disposable in a `\l` listing. */
export function scratchName(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  // Not a ULID: this is a database name, and hyphens would force quoting everywhere.
  return `yaf_scratch_${slug}_${randomBytes(4).toString('hex')}`;
}

/** Replace the database in a connection URL, keeping every parameter. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The database a URL points at. */
export function databaseOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

async function administer(adminUrl: string, statement: string): Promise<void> {
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  try {
    // `CREATE`/`DROP DATABASE` cannot run inside a transaction block, so these are issued as
    // bare statements on their own connection.
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export interface ScratchDatabase {
  readonly url: string;
  readonly name: string;
  /** Drops the database. Safe to call twice. */
  drop(): Promise<void>;
}

/**
 * Create a scratch database alongside the one `adminUrl` points at.
 *
 * The caller's own database is the maintenance connection. Guessing at `postgres` or `neondb`
 * would work on one provider and not the other.
 */
export async function createScratchDatabase(
  adminUrl: string,
  label: string,
): Promise<ScratchDatabase> {
  const name = scratchName(label);
  await administer(adminUrl, `CREATE DATABASE "${name}"`);

  let dropped = false;
  return {
    name,
    url: withDatabase(adminUrl, name),
    async drop() {
      if (dropped) return;
      dropped = true;
      // WITH (FORCE) terminates stragglers. Without it a leaked client makes the drop hang,
      // and the next run inherits a database full of the previous run's rows.
      await administer(adminUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}
