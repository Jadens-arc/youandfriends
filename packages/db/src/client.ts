import { neon } from '@neondatabase/serverless';
import { type ServerEnv, requireServerEnv } from '@youandfriends/config';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { schema, type Schema } from './schema/index';

/**
 * Two connection modes, and the difference is not a detail.
 *
 * Neon's serverless HTTP driver sends each statement as its own request. It is the right
 * choice for a route handler — no socket to keep warm, no pool to exhaust — but it cannot
 * hold an interactive transaction, because there is no session to hold it open in. The
 * direct TCP driver can.
 *
 * Getting that wrong is silent: a "transaction" over HTTP runs as loose statements, and a
 * failure halfway through leaves the write half-applied. So the modes are branded, and
 * `withTransaction` accepts only the direct one. The wrong driver is a type error rather
 * than a corrupted row (`docs/ARCHITECTURE.md` §4).
 */
declare const MODE: unique symbol;

/** HTTP/serverless connection for route handlers. Cannot hold a transaction. */
export type PooledDatabase = NeonHttpDatabase<Schema> & { readonly [MODE]: 'pooled' };

/** Direct TCP connection for migrations, jobs, and anything transactional. */
export type DirectDatabase = NodePgDatabase<Schema> & { readonly [MODE]: 'direct' };

/** Either mode, for reads that do not care. */
export type Database = PooledDatabase | DirectDatabase;

/**
 * A pooled client, for route handlers.
 *
 * Requiredness lives here rather than in the env schema: the design system does not need a
 * database, and refusing to boot the whole app without `DATABASE_URL` would block work that
 * has nothing to do with data.
 */
export function createPooledClient(env: ServerEnv): PooledDatabase {
  requireServerEnv(env, ['DATABASE_URL']);
  // The brand exists only in the type system, so it has to be applied at the boundary. This
  // is the one place either cast appears; everywhere else the modes are distinct types.
  return drizzleHttp(neon(env.DATABASE_URL), { schema }) as unknown as PooledDatabase;
}

/**
 * How long to wait for a TCP connection before giving up.
 *
 * `pg` waits forever by default. That turns an unreachable database — a wrong host, a
 * firewall, a network policy that does not allow the port — into a build that hangs rather
 * than one that fails, and a hung release gate is worse than a red one: nobody knows whether
 * to wait or to kill it. Ten seconds is generous for a cold Neon compute.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/** The connection pool behind a direct client, exposed so callers can close it. */
export interface DirectConnection {
  readonly db: DirectDatabase;
  /** Always call this. A leaked pool keeps a Neon compute awake, which costs money. */
  close(): Promise<void>;
}

/**
 * A direct client, for migrations, jobs, and transactions.
 *
 * `DATABASE_URL_UNPOOLED` and not `DATABASE_URL`: running a transaction through Neon's
 * pooler is the failure this whole distinction exists to prevent.
 */
export function createDirectClient(env: ServerEnv, options?: { max?: number }): DirectConnection {
  requireServerEnv(env, ['DATABASE_URL_UNPOOLED']);

  const pool = new Pool({
    connectionString: env.DATABASE_URL_UNPOOLED,
    max: options?.max ?? 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  return {
    db: drizzleNode(pool, { schema }) as unknown as DirectDatabase,
    close: () => pool.end(),
  };
}
