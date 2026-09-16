#!/usr/bin/env node
/**
 * The purge job. `pnpm --filter @youandfriends/db purge [--dry-run] [--workspace ID] [--limit N]`
 *
 * This is the only command in the repository that destroys user work, so it is built to be
 * boring:
 *
 *   - **`--dry-run` is not a flag that skips the deletes.** It takes a different code path
 *     that never opens a write transaction, so a mistake in the flag handling cannot destroy
 *     anything.
 *   - **It prints the plan before acting, always** — dry run or not. Somebody reading the job
 *     output afterwards can see exactly what was intended.
 *   - **It refuses rather than guesses.** Anything with a live reference is held back and the
 *     reason is printed.
 *
 * Storage deletion is not wired yet: `packages/storage` arrives in task `050`. Until then a
 * plan naming storage objects makes the run refuse, rather than deleting rows and orphaning
 * the objects they pointed at.
 *
 * Console output is this file's entire product, so `no-console` is disabled here rather than
 * routed through the structured logger, which writes for machines.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { parseServerEnv } from '@youandfriends/config';

import { createDirectClient } from '../src/client.ts';
import { loadDatabaseEnv, REPO_ROOT } from '../src/env-file.ts';
import { describePlan, executePurge, planPurge } from '../src/purge.ts';
import { withTransaction } from '../src/transaction.ts';

loadDatabaseEnv(REPO_ROOT);

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const dryRun = has('--dry-run');
const workspaceId = value('--workspace');
const limitArgument = value('--limit');
const limit = limitArgument === undefined ? undefined : Number.parseInt(limitArgument, 10);

if (limitArgument !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error(`--limit must be a positive integer, got ${limitArgument}`);
  process.exit(2);
}

const env = parseServerEnv();
if (env.DATABASE_URL_UNPOOLED === undefined || env.DATABASE_URL_UNPOOLED === '') {
  console.error('SKIPPED: purge — DATABASE_URL_UNPOOLED is not set, so there is nothing to purge');
  process.exit(0);
}

const { db, close } = createDirectClient(env);

try {
  const plan = await planPurge(db, {
    now: new Date(),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(limit === undefined ? {} : { limit }),
  });

  // Printed before anything is destroyed, every time.
  console.log(describePlan(plan));

  if (dryRun) {
    console.log('\nDry run: nothing was destroyed.');
  } else if (plan.candidates.length === 0) {
    console.log('\nNothing to purge.');
  } else {
    const result = await withTransaction(db, (tx) => executePurge(tx, plan, null));
    console.log(
      `\nPurged ${result.purged.folders} folders, ${result.purged.projects} projects, ` +
        `${result.purged.songs} songs.`,
    );
  }
} catch (error) {
  console.error(`Purge failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
