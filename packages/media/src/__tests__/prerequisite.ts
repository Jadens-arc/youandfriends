/**
 * Whether this machine can run the media tests at all.
 *
 * Every test in this package shells out to a real ffmpeg or ffprobe, because the thing under
 * test is a parser for another program's output and faking that program would fake exactly what
 * varies. So on a machine without ffmpeg they cannot run.
 *
 * **They skip loudly** rather than failing, matching `unavailableReason()` in `packages/db` and
 * the MinIO harness in `packages/storage`, and matching the promise in `README.md`: a prerequisite
 * that is absent says so and says how to fix it. Failing instead would make `pnpm test` red for
 * every contributor who has not installed ffmpeg yet, with a stack trace rather than an answer.
 *
 * A silent skip would be the worse mistake in the other direction (CLAUDE.md §7) — which is why
 * this prints, and why `release-check` reports the skip in its own summary.
 */
import { execFileSync } from 'node:child_process';

import { ffmpegPath, ffprobePath } from '../run';

/**
 * `null` when both binaries are present, otherwise why not.
 *
 * Synchronous and run at module load, because `describe.skip` has to be decided before the suite
 * is registered. One `-version` call each is cheap.
 */
export function unavailableReason(): string | null {
  const missing: string[] = [];

  for (const [name, binary] of [
    ['ffmpeg', ffmpegPath()],
    ['ffprobe', ffprobePath()],
  ] as const) {
    try {
      execFileSync(binary, ['-version'], { stdio: 'ignore', timeout: 10_000 });
    } catch {
      missing.push(name);
    }
  }

  if (missing.length === 0) return null;
  return (
    `${missing.join(' and ')} not found — install ffmpeg (apt install ffmpeg / brew install ffmpeg), ` +
    'or set YOUANDFRIENDS_FFMPEG_PATH and YOUANDFRIENDS_FFPROBE_PATH'
  );
}

/**
 * Announce the skip once per test file, loudly enough to read in CI output.
 *
 * Deliberately not a bare `describe.skip`: a suite that vanishes from the run without comment is
 * indistinguishable from one that passed, which is the specific lie CLAUDE.md §7 forbids.
 */
export function announceSkip(suite: string, reason: string): void {
  console.warn(`SKIPPING ${suite}: ${reason}`);
}
