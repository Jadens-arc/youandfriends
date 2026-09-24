import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { transcodeArgs } from '../derivative';
import { run, ToolError, untrustedInput } from '../run';

/**
 * These use a shell stub rather than ffmpeg, because the property under test is how a *child*
 * that refuses to die is handled, and a cooperative binary cannot demonstrate it.
 */
describe('running a tool', () => {
  async function stub(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'run-stub-'));
    const path = join(dir, 'stub');
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  }

  it('kills a child that ignores SIGTERM, rather than waiting forever', async () => {
    // **The guarantee the docstring makes.** `execFile`'s timeout only signals and then waits for
    // `close`, so with the default SIGTERM this promise never settles — measured at over six
    // seconds against a 1.5s limit before the fix. ffmpeg defers SIGTERM exactly this way: its
    // handler sets a flag checked at the next loop iteration, which a thread blocked in a demuxer
    // read never reaches. One wedged job would hold a worker slot permanently, and the scratch
    // directory with it.
    const path = await stub("trap '' TERM\nsleep 30");

    const started = Date.now();
    await expect(run(path, [], { timeoutMs: 1000 })).rejects.toMatchObject({
      name: 'ToolError',
      reason: 'timed_out',
    });

    // Settled near the deadline, not at the stub's 30 seconds.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it('still reports a cooperative child that simply takes too long', async () => {
    const path = await stub('sleep 30');
    await expect(run(path, [], { timeoutMs: 500 })).rejects.toMatchObject({ reason: 'timed_out' });
  }, 30_000);

  it('classifies a non-zero exit as a failure, with its stderr', async () => {
    const path = await stub('echo "something went wrong" >&2\nexit 3');
    const error = await run(path, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).reason).toBe('failed');
    expect((error as ToolError).stderr).toContain('something went wrong');
  }, 30_000);

  it('returns stdout when the tool succeeds', async () => {
    const path = await stub("printf '%s' hello");
    await expect(run(path, [])).resolves.toBe('hello');
  }, 30_000);
});

describe('arguments for an untrusted input (task `068`, T12)', () => {
  it('pins the protocol whitelist to file before the input', () => {
    expect(untrustedInput('/scratch/original')).toEqual([
      '-protocol_whitelist',
      'file',
      '-i',
      '/scratch/original',
    ]);
  });

  it('refuses a relative path, which ffmpeg could read as an option or a URL', () => {
    for (const path of ['-f', 'http://example.test/x', 'original', 'concat:a|b']) {
      expect(() => untrustedInput(path)).toThrow(/relative media path/);
    }
  });

  it('is what the transcode recipe uses', () => {
    const args = transcodeArgs('/in/original.wav', '/out/stream.m4a', {
      bitrate: '192k',
      encoder: 'aac',
    });
    const at = args.indexOf('-i');
    expect(args.slice(at - 2, at + 2)).toEqual([
      '-protocol_whitelist',
      'file',
      '-i',
      '/in/original.wav',
    ]);
  });
});
