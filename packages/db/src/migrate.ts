import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseServerEnv, type ServerEnv } from '@youandfriends/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDirectClient } from './client';

/** Where `drizzle-kit generate` writes SQL. Shared by the migrator and the dry run. */
export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

/** The SQL files currently on disk, in application order. */
export function pendingFiles(folder: string = MIGRATIONS_FOLDER): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.endsWith('.sql'))
      .sort();
  } catch {
    // No folder yet is not an error: task `021` adds the first migration.
    return [];
  }
}

export interface MigrateResult {
  readonly applied: number;
  readonly files: readonly string[];
}

/**
 * Apply migrations over the direct connection.
 *
 * Never the pooled one. A migration is a transaction, and the HTTP driver cannot hold one —
 * a half-applied schema change is the single worst state this system can be left in.
 */
export async function runMigrations(
  env: ServerEnv = parseServerEnv(),
  folder: string = MIGRATIONS_FOLDER,
): Promise<MigrateResult> {
  const files = pendingFiles(folder);
  const { db, close } = createDirectClient(env);

  try {
    await migrate(db, { migrationsFolder: folder });
    return { applied: files.length, files };
  } finally {
    await close();
  }
}
