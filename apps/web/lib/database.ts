import 'server-only';

import { createDirectClient, type DirectDatabase } from '@youandfriends/db';
import { parseServerEnv } from '@youandfriends/config';

let direct: DirectDatabase | null = null;

/**
 * The request-time handle for anything that must be atomic.
 *
 * `authDatabase()` is the pooled HTTP driver, which cannot hold a transaction (see
 * `packages/db/src/client.ts`). Provisioning a workspace writes three rows — the workspace, its
 * owner's membership, and the audit event — and ADR 0006 requires the audit event to commit or
 * roll back with the change. That needs a real transaction, so a real connection.
 *
 * A small pool, memoized per warm instance. Two connections rather than one, so a request that
 * holds a transaction does not queue every concurrent request on the same instance behind it;
 * not more, because Neon's unpooled endpoint counts connections and serverless instances
 * multiply them.
 */
export function transactionalDatabase(): DirectDatabase {
  direct ??= createDirectClient(parseServerEnv(), { max: 2 }).db;
  return direct;
}
