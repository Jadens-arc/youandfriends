#!/usr/bin/env node
/**
 * You & Friends — release check.
 *
 * Runs every quality gate in fast-to-slow order and reports honestly.
 *
 * Later tasks register their own gates:
 *   `020` migration dry run     · `023` db/authz integration · `052` storage contract (MinIO)
 *   `066` media fixtures        · `118` Rust clippy + tests  · `120` Playwright
 *   `122` dependency threshold and secret scan
 *
 * Two rules this script exists to enforce:
 *   - A gate whose prerequisite is absent SKIPS LOUDLY. It never passes silently — a silent
 *     pass is a lie in the build output (CLAUDE.md §7).
 *   - A failure names the gate and the exact command to reproduce it.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * @typedef {object} Gate
 * @property {string} name
 * @property {string} command
 * @property {string} [reproduce]   Command that reproduces the failure locally.
 * @property {boolean} [advisory]   Reports but never fails the run.
 * @property {() => string | null} [skipReason]
 */

/** @type {Gate[]} */
const GATES = [
  { name: 'format', command: 'pnpm format:check', reproduce: 'pnpm format' },
  {
    name: 'task index',
    command: 'node scripts/generate-status.mjs --check',
    reproduce: 'node scripts/generate-status.mjs',
  },
  {
    // Registered by task `023`. Prose about permissions drifts from behaviour invisibly: the
    // document still reads correctly, it is just no longer true. It is generated from the
    // table the tests execute, so staleness is the only failure mode left, and this catches it.
    name: 'permission matrix',
    // `tsx`, not `node`: the generator imports the same TypeScript table the tests execute,
    // which is the point — a generator with its own copy of the data would drift too.
    command: 'pnpm generate:permission-matrix -- --check',
    reproduce: 'pnpm generate:permission-matrix',
  },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'unit', command: 'pnpm test' },
  {
    // Registered by task `023`. Runs inside `unit` too; listed separately because this is the
    // suite that gates every collaboration route, and it should be visible in the gate list
    // rather than buried in a workspace-wide run. Skips loudly without a database.
    name: 'db/authz integration',
    command: 'pnpm --filter @youandfriends/authz test',
  },
  { name: 'build', command: 'pnpm build' },
  {
    // Registered by task `020`. `docs/OPERATIONS.md` §4 requires a dry run before every
    // production migration: a migration that fails halfway leaves a state no rollback script
    // anticipated. The command itself announces a skip when no database is configured, so a
    // developer without one still sees why the gate did not run.
    name: 'migration dry run',
    command: 'pnpm --filter @youandfriends/db migrate:dry',
    reproduce: 'pnpm --filter @youandfriends/db migrate:dry',
  },
  {
    name: 'dependency audit',
    command: 'pnpm audit --audit-level=high',
    // Advisory until task `122` decides the failure threshold, so a transitive advisory
    // cannot block all work in the meantime.
    advisory: true,
  },
];

/** Gates a later task will register. Listed so their absence is visible, not forgotten. */
const PENDING_GATES = [
  ['storage contract (MinIO)', 'task 052'],
  ['media fixtures (ffmpeg)', 'task 066'],
  ['rust clippy + tests', 'task 118'],
  ['playwright (desktop + iPhone)', 'task 120'],
  ['secret scan', 'task 122'],
];

const pad = (s) => s.padEnd(24);

if (process.argv.includes('--list')) {
  console.log('\nRELEASE CHECK — registered gates\n');
  for (const g of GATES) {
    console.log(`  ${pad(g.name)} ${g.command}${g.advisory ? '   (advisory)' : ''}`);
  }
  console.log('\nNot yet registered\n');
  for (const [name, task] of PENDING_GATES) console.log(`  ${pad(name)} ${task}`);
  console.log('');
  process.exit(0);
}

console.log('\nRELEASE CHECK\n');

const results = [];
let blocker = null;

for (const gate of GATES) {
  const skip = gate.skipReason?.() ?? null;
  if (skip) {
    console.log(`  ${pad(gate.name)} SKIPPED — ${skip}`);
    results.push({ gate, status: 'skipped', reason: skip });
    continue;
  }

  const started = Date.now();
  const result = spawnSync(gate.command, { shell: true, stdio: 'inherit' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status === 0) {
    console.log(`  ${pad(gate.name)} pass (${secs}s)`);
    results.push({ gate, status: 'pass' });
  } else if (gate.advisory) {
    console.log(`  ${pad(gate.name)} ADVISORY FINDINGS (${secs}s) — not blocking`);
    results.push({ gate, status: 'advisory' });
  } else {
    console.log(`  ${pad(gate.name)} FAIL (${secs}s)`);
    results.push({ gate, status: 'fail' });
    blocker = gate;
    break;
  }
}

console.log('');

const skipped = results.filter((r) => r.status === 'skipped');
if (skipped.length > 0) {
  console.log('SKIPPED:');
  for (const { gate, reason } of skipped) console.log(`  ${gate.name} — ${reason}`);
  console.log('');
}

for (const [name, task] of PENDING_GATES) {
  console.log(`  NOT YET REGISTERED: ${pad(name)} (${task})`);
}
console.log('');

if (blocker) {
  console.error('VERDICT: not shippable');
  console.error(`BLOCKER: ${blocker.name}`);
  console.error(`REPRODUCE: ${blocker.reproduce ?? blocker.command}\n`);
  process.exit(1);
}

const advisory = results.filter((r) => r.status === 'advisory').map((r) => r.gate.name);
console.log('VERDICT: registered gates pass');
if (advisory.length > 0) console.log(`ADVISORY: ${advisory.join(', ')} — review, not blocking`);
console.log('NOTE: gates listed above as not yet registered are not covered by this run.\n');
