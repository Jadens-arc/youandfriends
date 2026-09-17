#!/usr/bin/env node
/**
 * Apply migrations. `pnpm --filter @youandfriends/db migrate`
 *
 * Prints what it did and exits non-zero on failure. This runs unattended in a deploy
 * pipeline, where a silent failure is indistinguishable from success.
 *
 * Console output is this file's entire product, so `no-console` is disabled here rather
 * than routed through the structured logger, which writes for machines.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { loadDatabaseEnv, REPO_ROOT } from '../src/env-file.ts';
import { runMigrations } from '../src/migrate.ts';
import { describeTarget } from '../src/target-host.ts';

// The same lookup the test harness uses, so the two cannot disagree about which database
// this is pointed at. Safe to call after the imports: nothing above reads the environment
// until it is invoked.
loadDatabaseEnv(REPO_ROOT);

// Say what is about to be written to, before writing to it (`docs/THREAT_MODEL.md` T10).
//
// **Not a refusal.** A migration is *meant* to run against production — that is what it is for,
// and one that refuses production is one that never ships. So the control here is announcement,
// not a target check: an operator with two shells open has no other way to tell them apart.
console.log(`Target: ${describeTarget(process.env.DATABASE_URL_UNPOOLED)}`);

try {
  const { applied, files } = await runMigrations();
  console.log(`Applied ${applied} migration${applied === 1 ? '' : 's'}.`);
  for (const file of files) console.log(`  ${file}`);
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
