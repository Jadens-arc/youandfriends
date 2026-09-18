#!/usr/bin/env node
/**
 * Regenerate `tasks/STATUS.md` from the task files.
 *
 * The task files are the source of truth for their own status and commit SHA. STATUS.md is
 * the index over them. Maintaining the index by hand meant it silently drifted — string
 * edits stopped matching once Prettier reformatted the table columns, and the index claimed
 * tasks were pending that had already shipped.
 *
 *   node scripts/generate-status.mjs           regenerate
 *   node scripts/generate-status.mjs --check    fail if stale (used by release-check)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import * as prettier from 'prettier';

const TASKS_DIR = 'tasks';
const STATUS_PATH = join(TASKS_DIR, 'STATUS.md');

function field(source, heading) {
  const match = source.match(new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : '';
}

function readTasks() {
  return readdirSync(TASKS_DIR)
    .filter((name) => /^\d{3}-.*\.md$/.test(name))
    .sort()
    .map((name) => {
      const source = readFileSync(join(TASKS_DIR, name), 'utf8');
      const number = name.slice(0, 3);
      const title = source.match(/^# \d{3} — (.+)$/m)?.[1] ?? name;
      const phase = source.match(/\*\*Phase:\*\* (.+?) ·/)?.[1] ?? '';
      const iteration = source.match(/\*\*Iteration:\*\* (.+)$/m)?.[1]?.trim() ?? '';
      const status = field(source, 'Status').replace(/`/g, '').trim();

      let deps = field(source, 'Dependencies').split('\n')[0].trim();
      if (/^none/i.test(deps)) deps = '—';

      const rawCommit = field(source, 'Commit').split('\n')[0].trim();
      const commit = rawCommit.includes('not yet') ? '—' : rawCommit.replace(/`/g, '').slice(0, 7);

      const blocker = field(source, 'Blocker') || '—';

      return { number, title, phase, deps, status, commit, blocker, iteration };
    });
}

function table(rows) {
  const header =
    '| # | Title | Phase | Depends on | Status | Commit | Blocker |\n| --- | --- | --- | --- | --- | --- | --- |';
  const body = rows
    .map(
      (r) =>
        `| \`${r.number}\` | ${r.title} | ${r.phase} | ${r.deps} | \`${r.status}\` | ${
          r.commit === '—' ? '—' : `\`${r.commit}\``
        } | ${r.blocker} |`,
    )
    .join('\n');
  return `${header}\n${body}`;
}

function render(tasks) {
  const iterationOne = tasks.filter((t) => !t.iteration.includes('deferred'));
  const deferred = tasks.filter((t) => t.iteration.includes('deferred'));

  const complete = iterationOne.filter((t) => t.status === 'complete');
  const inProgress = iterationOne.find((t) => t.status === 'in-progress');
  const blocked = iterationOne.filter((t) => t.status === 'blocked');

  // "Next" means the earliest *unblocked* pending task, per CLAUDE.md §2. Reading it off
  // task order alone named tasks whose dependencies had not shipped — a plausible-looking
  // answer that sends the next agent at work it cannot finish.
  const completeNumbers = new Set(complete.map((t) => t.number));
  const dependenciesMet = (task) =>
    [...task.deps.matchAll(/`(\d{3})`/g)].every(([, number]) => completeNumbers.has(number));

  const pending = iterationOne.filter((t) => t.status === 'pending');
  const nextUp = pending.find(dependenciesMet);
  // Pending tasks ahead of the next one, passed over because a dependency has not shipped.
  // Naming them is the point: silently skipping a task is how a plan loses work.
  const skipped = pending
    .slice(0, nextUp ? pending.indexOf(nextUp) : pending.length)
    .map((t) => `\`${t.number}\``);

  const position = inProgress
    ? `Task \`${inProgress.number}\` is \`in-progress\`.`
    : `Task \`${nextUp?.number ?? '—'}\` is next.${
        skipped.length > 0
          ? ` ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} passed over until ${
              skipped.length === 1 ? 'its' : 'their'
            } dependencies are \`complete\`.`
          : ''
      }`;

  return `# You & Friends — Task Status

_A private music workspace by Avery and Friends._

**This is the canonical index. Read it first, before any other file.**

> Generated from the task files by \`scripts/generate-status.mjs\`. Each task file owns its own
> status and commit SHA; this table is the index over them. Do not hand-edit — run
> \`node scripts/generate-status.mjs\` instead. \`release-check\` fails if this file is stale.

Protocol, status meanings, and the commit-SHA recording rule are documented in
\`tasks/README.md\`. A task is never marked \`complete\` with a failing test or an unmet
acceptance criterion.

## Summary

|                     | Count |
| ------------------- | ----- |
| Iteration-one tasks | ${iterationOne.length} |
| Deferred tasks | ${deferred.length} |
| **Total** | **${tasks.length}** |

${position} ${complete.length} of ${iterationOne.length} iteration-one tasks are \`complete\`.${
    blocked.length > 0 ? ` **${blocked.length} blocked.**` : ''
  }

## Iteration one

${table(iterationOne)}

## Deferred — planned, numbered, and out of iteration-one scope

These are not omissions. Each is a real task with dependencies, to be scheduled after the
iteration-one milestone.

${table(deferred)}

## Notes on specific tasks

- \`208\`, \`209\` — Billing and public signup require product and legal decisions that are
  explicitly not engineering's to make alone. Both are marked in their files as needing user
  direction before work begins.
- \`215\` — Data export, retention, and account closure is a **launch prerequisite** per
  \`docs/DESIGN.md\` §13, not an optional extra.
- \`125\` — The iteration-one closeout is followed by a metadata-only commit, the single
  documented exception to the one-task-per-commit rule.
- \`004\`, \`005\` — Added after task \`003\`'s review surfaced two gaps in controls written
  during \`001\` and \`003\`. Recorded rather than folded silently into an unrelated task.
- \`058\` — Split out of \`051\` before coding. The upload protocol does not need HTTP to be
  correct, but a route needs to resolve a workspace from a request, and that is \`031\`, which is
  \`pending\`. \`051\` delivers the tested protocol; \`058\` puts transport in front of it.
  \`053\` depends on both.
- \`050\`, \`051\` — Both landed **without a live run against an object store**: no byte has yet
  moved through the storage path. Their logic is tested against a stub driver that can be made to
  answer wrongly on purpose, which a real bucket cannot, but that is not the same evidence.
  \`052\` (MinIO contract tests) is where the real path is exercised and should run before
  anything else is built on top of them.
`;
}

// Format with Prettier here, so generated output and formatted output are the same string.
// Otherwise `--check` fails the moment `pnpm format` touches the file.
const raw = render(readTasks());
const options = (await prettier.resolveConfig(STATUS_PATH)) ?? {};
const rendered = await prettier.format(raw, { ...options, parser: 'markdown' });

if (process.argv.includes('--check')) {
  const current = readFileSync(STATUS_PATH, 'utf8');
  if (current.trim() !== rendered.trim()) {
    console.error('tasks/STATUS.md is stale. Run: node scripts/generate-status.mjs');
    process.exit(1);
  }
  console.log('tasks/STATUS.md is current.');
} else {
  writeFileSync(STATUS_PATH, rendered);
  console.log('tasks/STATUS.md regenerated.');
}
