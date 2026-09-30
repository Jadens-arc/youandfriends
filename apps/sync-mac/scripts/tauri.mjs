#!/usr/bin/env node
/**
 * Build or run the Tauri app — on macOS. Anywhere else, SKIP LOUDLY (task `111`): the app is
 * macOS-only by design, and a confusing linker error on Linux is not a skip.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.log(
    `SKIPPED: You & Friends Sync builds only on macOS (this is ${process.platform}). ` +
      'The agent logic is tested everywhere with `cargo test -p youandfriends-sync-core`.',
  );
  process.exit(0);
}
const mode = process.argv[2] === 'dev' ? 'dev' : 'build';
const result = spawnSync('pnpm', ['exec', 'tauri', mode], {
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url),
});
process.exit(result.status ?? 1);
