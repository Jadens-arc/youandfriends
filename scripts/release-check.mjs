#!/usr/bin/env node
/**
 * You & Friends — release check.
 *
 * Runs every quality gate in fast-to-slow order and reports honestly.
 *
 * Task `001` establishes the script. Later tasks register their own gates:
 *   `052` storage contract (MinIO) · `066` media fixtures (ffmpeg)
 *   `118` Rust clippy and tests   · `120` Playwright · `122` dependency and secret scanning
 *
 * A gate whose prerequisite is absent SKIPS LOUDLY. It never passes silently — a silent
 * pass is a lie in the build output.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * @typedef {object} Gate
 * @property {string} name
 * @property {string} command
 * @property {string} [reproduce]
 * @property {() => string | null} [skipReason] Return a reason to skip, or null to run.
 */

/** @type {Gate[]} */
const GATES = [
  { name: 'format', command: 'pnpm format:check', reproduce: 'pnpm format' },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'unit', command: 'pnpm test' },
  { name: 'build', command: 'pnpm build' },
];

/** Gates registered by later tasks. Listed so their absence is visible, not forgotten. */
const PENDING_GATES = [
  ['db/authz integration', 'task 023'],
  ['storage contract (MinIO)', 'task 052'],
  ['media fixtures (ffmpeg)', 'task 066'],
  ['rust clippy + tests', 'task 118'],
  ['playwright (desktop + iPhone)', 'task 120'],
  ['migration dry run', 'task 020'],
  ['dependency audit', 'task 122'],
  ['secret scan', 'task 122'],
];

const listOnly = process.argv.includes('--list');

if (listOnly) {
  console.log('\nRELEASE CHECK — registered gates\n');
  for (const gate of GATES) console.log(`  ${gate.name.padEnd(32)} ${gate.command}`);
  console.log('\nPending registration\n');
  for (const [name, task] of PENDING_GATES) console.log(`  ${name.padEnd(32)} ${task}`);
  console.log('');
  process.exit(0);
}

console.log('\nRELEASE CHECK\n');

const results = [];
let failed = null;

for (const gate of GATES) {
  const skip = gate.skipReason?.() ?? null;
  if (skip) {
    console.log(`  ${gate.name.padEnd(32)} SKIPPED — ${skip}`);
    results.push({ gate, status: 'skipped', reason: skip });
    continue;
  }

  const started = Date.now();
  const result = spawnSync(gate.command, { shell: true, stdio: 'inherit' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status === 0) {
    console.log(`  ${gate.name.padEnd(32)} pass (${seconds}s)`);
    results.push({ gate, status: 'pass' });
  } else {
    console.log(`  ${gate.name.padEnd(32)} FAIL (${seconds}s)`);
    results.push({ gate, status: 'fail' });
    failed = gate;
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
  console.log(`  NOT YET REGISTERED: ${name.padEnd(32)} (${task})`);
}
console.log('');

if (failed) {
  console.error('VERDICT: not shippable');
  console.error(`BLOCKER: ${failed.name}`);
  console.error(`REPRODUCE: ${failed.reproduce ?? failed.command}\n`);
  process.exit(1);
}

console.log('VERDICT: registered gates pass');
console.log('NOTE: gates listed above as not yet registered are not covered by this run.\n');
