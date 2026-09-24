#!/usr/bin/env node
/**
 * `pnpm --filter @youandfriends/jobs ops:media:retry` (task `064`, `docs/OPERATIONS.md` §10).
 *
 *   --version <assetVersionId>   retry one version's job
 *   --all-failed                 retry every failed job
 *   --stranded                   with --all-failed, also jobs queued for 15 minutes with nothing
 *                                picking them up, and jobs `running` long past any attempt's limit
 *   --workspace <id>             limit --all-failed to one workspace
 *   --limit <n>                  at most n jobs
 *   --inline                     run the pipeline in this process instead of dispatching
 *   --dry-run                    print the plan and stop
 *
 * A composition root, like `packages/db/bin/uploads-sweep.mjs`: it builds the real dispatcher
 * from the environment. With no `TRIGGER_SECRET_KEY` and no `--inline`, jobs are reset and left
 * `queued` with that reason — never marked done. Console output is the product here.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { parseServerEnv } from '@youandfriends/config';
import { createDirectClient } from '@youandfriends/db';
import { loadDatabaseEnv, REPO_ROOT } from '@youandfriends/db/env-file';
import { InlineDispatcher, TriggerDispatcher } from '@youandfriends/media';

import { triggerClientFrom } from '../src/client.ts';
import { describeRetryPlan, executeMediaRetry, planMediaRetry } from '../src/ops/retry.ts';
import { MAX_ATTEMPTS, processAudioVersion } from '../src/pipeline.ts';
import { workerDeps } from '../src/worker.ts';

loadDatabaseEnv(REPO_ROOT);

const argv = process.argv.slice(2);
/** @param {string} flag */
const has = (flag) => argv.includes(flag);
/** @param {string} flag */
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const version = value('--version');
const failed = has('--all-failed');
if ((version === undefined) === !failed) {
  console.error('Pass exactly one of --version <assetVersionId> or --all-failed.');
  process.exit(2);
}
const limitArgument = value('--limit');
const limit = limitArgument === undefined ? undefined : Number.parseInt(limitArgument, 10);
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error(`--limit must be a positive integer, got ${limitArgument}`);
  process.exit(2);
}

const env = parseServerEnv();
if (env.DATABASE_URL_UNPOOLED === undefined || env.DATABASE_URL_UNPOOLED === '') {
  console.error('SKIPPED: media retry — DATABASE_URL_UNPOOLED is not set');
  process.exit(0);
}

const { db, close } = createDirectClient(env);

try {
  const plan = await planMediaRetry(
    db,
    version === undefined
      ? {
          kind: 'all',
          includeStranded: has('--stranded'),
          workspaceId: value('--workspace'),
          limit,
        }
      : { kind: 'version', assetVersionId: version },
  );
  console.log(describeRetryPlan(plan));

  if (has('--dry-run')) {
    console.log('\nDry run: nothing was reset or dispatched.');
  } else if (plan.length > 0) {
    let dispatcher = null;
    if (has('--inline')) {
      const deps = workerDeps();
      dispatcher = new InlineDispatcher((input) =>
        processAudioVersion(deps, input, { number: MAX_ATTEMPTS, maxAttempts: MAX_ATTEMPTS }).then(
          () => undefined,
        ),
      );
    } else {
      const client = triggerClientFrom(env);
      dispatcher = client === null ? null : new TriggerDispatcher(client);
    }

    const reports = await executeMediaRetry(db, dispatcher, plan);
    let undispatched = 0;
    for (const report of reports) {
      if (report.result.dispatched) {
        console.log(`  ${report.assetVersionId}: dispatched as ${report.result.runId}`);
      } else {
        undispatched += 1;
        console.error(`  ${report.assetVersionId}: NOT dispatched — ${report.result.reason}`);
      }
    }
    if (undispatched > 0) process.exitCode = 1;
  }
} catch (error) {
  console.error(`Retry failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
