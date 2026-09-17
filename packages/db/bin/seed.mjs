#!/usr/bin/env node
/**
 * The development seed. `pnpm --filter @youandfriends/db seed [--reset]`
 *
 * Writes a realistic workspace — nested folders, projects, songs with version stacks,
 * collaborators at every role including a deny override — so layout and permission problems
 * surface before a user finds them.
 *
 * It refuses to run anywhere that is not unambiguously development or test. The check fails
 * closed: an unset `NODE_ENV` is a refusal, not an assumption.
 *
 * Console output is this file's product, so `no-console` is disabled here rather than routed
 * through the structured logger, which writes for machines.
 */
/* eslint-disable no-console */
import process from 'node:process';

import { parseServerEnv } from '@youandfriends/config';

import { createDirectClient } from '../src/client.ts';
import { loadDatabaseEnv, REPO_ROOT } from '../src/env-file.ts';
import { reset, seed } from '../src/seed/index.ts';
import { ENCODED_FORMATS, encoderAvailable } from '../src/seed/fixtures/audio.ts';
import { assertSeedAllowed, SeedRefusedError } from '../src/seed/guard.ts';

loadDatabaseEnv(REPO_ROOT);

const shouldReset = process.argv.slice(2).includes('--reset');

let permit;
try {
  // After `loadDatabaseEnv`, deliberately: the guard checks the URL that was loaded, not just
  // the environment label. Checking before the load would check nothing.
  permit = assertSeedAllowed(process.env);
} catch (error) {
  if (error instanceof SeedRefusedError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

const { db, close } = createDirectClient(parseServerEnv());

// Say what is about to be written to before writing to it, the way `purge.mjs` prints its plan.
console.log(`Target: ${permit.host}`);

try {
  if (shouldReset) {
    await reset(db, permit);
    console.log('Seed data removed.');
    console.log(
      '  Only rows this seed created were deleted, by id — anything else in the workspace is ' +
        'untouched. The workspace, its users, and their memberships remain, and re-running the ' +
        'seed rebuilds the content on top of them.',
    );
  } else {
    const result = await seed(db, permit);
    console.log(`Seeded workspace ${result.workspaceId}:`);
    console.log(`  ${result.users} collaborators, one at each role, plus a deny override`);
    console.log(`  ${result.folders} folders, ${result.projects} projects, ${result.songs} songs`);
    console.log(`  ${result.mixVersions} mix versions`);
    console.log(
      `  ${result.mixVersions} storage_object rows describing ` +
        `${(result.fixtureBytes / 1024).toFixed(0)} KB of generated tones — never real music`,
    );

    // The bytes were generated and hashed, and then discarded. Saying so matters: a
    // `storage_objects` row that names a bucket and a checksum reads like evidence the object
    // is in that bucket, and a later task could treat it that way.
    console.log(
      '\nNOTE: no bytes were uploaded. The rows carry real sizes and SHA-256 checksums of ' +
        'tones generated in memory, but object storage arrives with task 050, so nothing ' +
        'exists in any bucket yet and playback will not work.',
    );

    if (!encoderAvailable()) {
      // Loud, not silent. A fixture that claimed to be a FLAC and was not would make task
      // `066`'s media tests pass against something that was never encoded.
      console.log(
        `\nSKIPPED: ${ENCODED_FORMATS.join(', ')} fixtures — no encoder available. ` +
          'ffmpeg arrives with task 064 (ADR 0002); WAV is generated natively.',
      );
    }
  }
} catch (error) {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
