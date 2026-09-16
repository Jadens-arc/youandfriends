import { parseServerEnv } from '@youandfriends/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * The unpooled URL, always. `drizzle-kit` runs DDL in transactions, and Neon's pooler cannot
 * carry one — pointing this at `DATABASE_URL` produces migrations that appear to apply and
 * do not.
 */
const env = parseServerEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: env.DATABASE_URL_UNPOOLED ?? '' },
  strict: true,
  verbose: true,
});
