#!/usr/bin/env node
/**
 * Dry-run migrations against a scratch database. `pnpm --filter @youandfriends/db migrate:dry`
 *
 * Exit codes: 0 passed, 0 skipped (announced), 1 failed. The skip is loud on purpose — a
 * silent pass with no database configured would be a lie in the build output (CLAUDE.md §7).
 *
 * Console output is this file's entire product, so `no-console` is disabled here rather
 * than routed through the structured logger, which writes for machines.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { dryRunMigrations } from '../src/dry-run.ts';
import { loadDatabaseEnv, REPO_ROOT } from '../src/env-file.ts';

// The same lookup the test harness uses, so the two cannot disagree about which database
// this is pointed at. Safe to call after the imports: nothing above reads the environment
// until it is invoked.
loadDatabaseEnv(REPO_ROOT);

const outcome = await dryRunMigrations();

if (outcome.status === 'skipped') {
  console.log(`SKIPPED: migration dry run — ${outcome.reason}`);
} else if (outcome.status === 'passed') {
  console.log(`Migration dry run passed: ${outcome.applied} applied to ${outcome.database}.`);
} else {
  console.error(`Migration dry run FAILED on ${outcome.database}: ${outcome.error.message}`);
  process.exit(1);
}
