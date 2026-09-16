import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Files searched, in order. All are `.gitignore`d; none may be committed. */
export const ENV_FILES = ['.env.test.local', '.env.local'] as const;

/** Variables this loader will take from a file. Nothing else, ever. */
export const LOADED_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const;

/**
 * Load the database URLs from the developer's local env file.
 *
 * A connection string is a credential, so it cannot live in the repository — which leaves
 * every database-touching entry point (the migrator, the dry run, the test harness) needing
 * the same lookup. Duplicating it three ways is how they drift, and the drift shows up as
 * "the tests skip but the migration runs", which reads like a bug in the code under test.
 *
 * Precedence: an ambient value always wins, because CI sets the real one. Files are read in
 * order and the first to define a key keeps it.
 *
 * A hand-rolled parser rather than `dotenv`: this needs two keys from files that usually do
 * not exist, and a dependency on the test and migration path is a dependency in the supply
 * chain. It deliberately understands nothing else — no interpolation, no `export`, no
 * multi-line values — so it cannot surprise anyone by interpreting a connection string.
 */
export function loadDatabaseEnv(
  root: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const pattern = new RegExp(`^\\s*(${LOADED_KEYS.join('|')})\\s*=\\s*(.*)$`);

  for (const file of ENV_FILES) {
    let contents: string;
    try {
      contents = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue;
    }

    for (const line of contents.split('\n')) {
      const match = pattern.exec(line);
      const key = match?.[1];
      const rawValue = match?.[2];
      if (key === undefined || rawValue === undefined) continue;

      const value = rawValue.trim().replace(/^["']|["']$/g, '');
      if (value !== '' && (env[key] === undefined || env[key] === '')) env[key] = value;
    }
  }
}

/** The repository root, relative to this package. */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
