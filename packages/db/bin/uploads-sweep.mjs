#!/usr/bin/env node
/**
 * The expired-upload sweep. `pnpm --filter @youandfriends/db ops:uploads:sweep [--dry-run]`
 * (`docs/OPERATIONS.md` §2.)
 *
 * Incomplete multipart parts are billed and referenced by nothing once their session expires.
 * This job aborts them in the store and marks the sessions, in that order.
 *
 * A **composition root**, per ADR 0008: it imports both `db` and `storage`, which the library
 * modules it calls may not. `executeUploadSweep` takes the aborter as an argument and never
 * reaches for a driver itself.
 *
 * Built like `bin/purge.mjs`, which it deliberately resembles:
 *
 *   - **`--dry-run` takes a different code path** rather than skipping the writes, so a mistake
 *     in flag handling cannot abort anything.
 *   - **It prints the plan before acting, always.**
 *   - **A failed abort leaves its session `pending`** and says so, rather than marking the row
 *     and stranding the parts where no later run will look.
 *
 * Console output is this file's entire product, so `no-console` is disabled here rather than
 * routed through the structured logger, which writes for machines.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { parseServerEnv } from '@youandfriends/config';
import { createR2Driver, r2ConfigFrom } from '@youandfriends/storage';

import { createDirectClient } from '../src/client.ts';
import { loadDatabaseEnv, REPO_ROOT } from '../src/env-file.ts';
import {
  describeSweepPlan,
  executeUploadSweep,
  planUploadSweep,
} from '../src/ops/uploads-sweep.ts';
import { describeTarget } from '../src/target-host.ts';

loadDatabaseEnv(REPO_ROOT);

const argv = process.argv.slice(2);
/** @param {string} flag */
const has = (flag) => argv.includes(flag);
/** @param {string} flag */
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const dryRun = has('--dry-run');
const workspaceId = value('--workspace');
const limitArgument = value('--limit');
const limit = limitArgument === undefined ? undefined : Number.parseInt(limitArgument, 10);

if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error(`--limit must be a positive integer, got ${limitArgument}`);
  process.exit(2);
}

const env = parseServerEnv();
if (env.DATABASE_URL_UNPOOLED === undefined || env.DATABASE_URL_UNPOOLED === '') {
  console.error('SKIPPED: uploads sweep — DATABASE_URL_UNPOOLED is not set');
  process.exit(0);
}

// Announced before the read that builds the plan, like purge does, and above the `try` so that a
// failure inside cannot preempt the one line saying which database the failure was about.
console.log(`Target: ${describeTarget(process.env.DATABASE_URL_UNPOOLED)}`);

const { db, close } = createDirectClient(env);

try {
  const plan = await planUploadSweep(db, {
    now: new Date(),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(limit === undefined ? {} : { limit }),
  });

  console.log(describeSweepPlan(plan));

  if (dryRun) {
    console.log('\nDry run: nothing was aborted or marked.');
  } else if (plan.sessions.length === 0) {
    console.log('\nNothing to sweep.');
  } else {
    // The driver is built only when there is work needing it, so a run with nothing to abort
    // does not require R2 credentials to be present.
    let abort = null;
    if (plan.abortable.length > 0) {
      // `'originals'` is not optional and not cosmetic. `r2ConfigFrom(env)` with the argument
      // omitted resolves to the *derivatives* bucket, and this job would then ask that bucket to
      // abort uploads that live in originals. R2 answers `NoSuchUpload`, every session lands in
      // `failed`, and the sweep reclaims nothing while printing errors that read like a transient
      // R2 problem. The dedicated `bin/**` typecheck must keep this arity visible.
      const driver = createR2Driver(r2ConfigFrom(env, 'originals'));
      abort = (/** @type {string} */ key, /** @type {string} */ uploadId) =>
        driver.abortMultipart(key, uploadId);
    }

    const result = await executeUploadSweep(db, plan, abort);

    console.log(
      `\nSwept ${result.swept} sessions, aborted ${result.aborted} multipart uploads, ` +
        `removed ${result.partRowsDeleted} part rows.`,
    );

    if (result.failed.length > 0) {
      // Not a summary line: each one is a session still holding billed parts, and it will be
      // retried next run. A human should see why before that becomes a standing failure.
      console.error(`\n${result.failed.length} sessions could not be aborted and stay pending:`);
      for (const failure of result.failed) {
        console.error(`  ${failure.id}: ${failure.reason}`);
      }
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`Sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
