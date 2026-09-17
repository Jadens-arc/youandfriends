/**
 * `@youandfriends/db`
 *
 * Drizzle schema, migrations, and the typed Neon client. The durable record.
 *
 * The one thing to know before using this package: there are two connection modes and they
 * are not interchangeable. Route handlers take the pooled (HTTP) client; migrations, jobs,
 * and anything transactional take the direct (TCP) one. `withTransaction` accepts only the
 * direct client, so the mistake is a type error rather than a half-applied write. See
 * `client.ts`.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/db' as const;

export {
  createDirectClient,
  createPooledClient,
  type Database,
  type DirectConnection,
  type DirectDatabase,
  type PooledDatabase,
} from './client';
export { dryRunMigrations, type DryRunOutcome } from './dry-run';
export { MIGRATIONS_FOLDER, pendingFiles, runMigrations, type MigrateResult } from './migrate';
export {
  createScratchDatabase,
  databaseOf,
  scratchName,
  withDatabase,
  type ScratchDatabase,
} from './scratch';
/**
 * The tables themselves, so callers name `songs` rather than `schema.songs`. `authz` builds
 * queries against these directly; everything else reaches them through a scoped handle.
 */
export * from './schema/index';
export {
  describePlan,
  executePurge,
  planPurge,
  type ObjectReaper,
  type PurgeCandidate,
  type PurgeOptions,
  type PurgePlan,
  type PurgeRefusal,
  type PurgeResult,
} from './purge';
export {
  deleteAsset,
  deleteFolder,
  deleteProject,
  deleteSong,
  excludeDeleted,
  hasSoftDelete,
  purgeAfterFrom,
  restoreBatch,
  RestoreBlockedError,
  type CascadeResult,
  type SoftDeleteOptions,
} from './soft-delete';
export { TransactionError, withTransaction, type Transaction } from './transaction';
