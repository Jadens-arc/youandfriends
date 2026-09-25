#!/usr/bin/env node
/**
 * Write every media fixture into a directory (task `066`):
 *
 *   pnpm --filter @youandfriends/media fixtures:generate [dir]
 *
 * The catalog is `catalog.ts`; this is its command-line face, for looking at the files by ear
 * or handing them to a local worker. Defaults to `.fixtures/`, which is git-ignored — generated
 * audio is never committed (CLAUDE.md §8). Needs ffmpeg for the compressed formats.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { MEDIA_FIXTURES, writeFixture } from './catalog.ts';

const dir = resolve(process.argv[2] ?? '.fixtures');
await mkdir(dir, { recursive: true });
for (const fixture of MEDIA_FIXTURES) {
  await rm(resolve(dir, fixture.name), { force: true });
  await rm(resolve(dir, `${fixture.name}.source.wav`), { force: true });
  const path = await writeFixture(fixture, dir);
  await rm(resolve(dir, `${fixture.name}.source.wav`), { force: true });
  console.log(path);
}
