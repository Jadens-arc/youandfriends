import { access, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEMP_BUDGET_BYTES,
  TempBudgetExceededError,
  withTempWorkspace,
} from '../workspace';

describe('job scratch space', () => {
  it('gives the job a private directory', async () => {
    const seen = await withTempWorkspace(async (workspace) => {
      await writeFile(join(workspace.dir, 'intermediate.wav'), new Uint8Array(16));
      await access(workspace.dir);
      return workspace.dir;
    });

    // Gone afterwards.
    await expect(access(seen)).rejects.toThrow();
  });

  it('cleans up when the job throws — the path that actually leaves debris', async () => {
    // A worker that cleans up after the jobs that succeed still fills its disk, because the ones
    // that crash are the ones that leave files behind. This is why cleanup is in a `finally`.
    let dir = '';

    await expect(
      withTempWorkspace(async (workspace) => {
        dir = workspace.dir;
        await writeFile(join(workspace.dir, 'half-written.m4a'), new Uint8Array(1024));
        throw new Error('ffmpeg fell over');
      }),
    ).rejects.toThrow('ffmpeg fell over');

    expect(dir).not.toBe('');
    await expect(access(dir)).rejects.toThrow();
  });

  it('lets the original error through rather than masking it with a cleanup failure', async () => {
    // If cleanup threw and replaced the real error, every crashed job would report a filesystem
    // problem and the actual cause would be lost.
    await expect(
      withTempWorkspace(async (workspace) => {
        // Remove the directory out from under the cleanup, so `rm` has nothing to do.
        const { rm } = await import('node:fs/promises');
        await rm(workspace.dir, { recursive: true, force: true });
        throw new Error('the real problem');
      }),
    ).rejects.toThrow('the real problem');
  });

  it('measures what has been written', async () => {
    await withTempWorkspace(async (workspace) => {
      expect(await workspace.usedBytes()).toBe(0);

      await writeFile(join(workspace.dir, 'a.bin'), new Uint8Array(1000));
      expect(await workspace.usedBytes()).toBe(1000);

      await mkdir(join(workspace.dir, 'nested'));
      await writeFile(join(workspace.dir, 'nested', 'b.bin'), new Uint8Array(500));
      expect(await workspace.usedBytes()).toBe(1500);
    });
  });

  it('refuses to continue once the budget is spent', async () => {
    await expect(
      withTempWorkspace(
        async (workspace) => {
          await writeFile(join(workspace.dir, 'big.bin'), new Uint8Array(2048));
          await workspace.assertWithinBudget();
          throw new Error('should not reach here');
        },
        { budgetBytes: 1024 },
      ),
    ).rejects.toBeInstanceOf(TempBudgetExceededError);
  });

  it('allows a job that stays inside its budget', async () => {
    const result = await withTempWorkspace(
      async (workspace) => {
        await writeFile(join(workspace.dir, 'small.bin'), new Uint8Array(100));
        await workspace.assertWithinBudget();
        return 'finished';
      },
      { budgetBytes: 1024 },
    );

    expect(result).toBe('finished');
  });

  it('does not count a symlink as though the job had written its target', async () => {
    // Otherwise a link to a large file on the host makes a job that wrote nothing look like one
    // that blew its budget — and the reverse, a job could hide bytes behind a link.
    await withTempWorkspace(async (workspace) => {
      const target = join(workspace.dir, 'real.bin');
      await writeFile(target, new Uint8Array(4096));
      await symlink(target, join(workspace.dir, 'link.bin'));

      expect(await workspace.usedBytes()).toBe(4096);
    });
  });

  it('refuses a prefix that could escape the temp directory', async () => {
    // The prefix is composed into a path that this function later removes recursively. The
    // docstring claimed no part of the name came from a caller, which was not true of this
    // argument — and task `062` naming a scratch dir after job metadata is a normal thing to do.
    for (const prefix of ['../escape-', 'a/b-', '/absolute-', '..']) {
      await expect(withTempWorkspace(async () => undefined, { prefix })).rejects.toThrow(
        /may only contain/,
      );
    }
  });

  it('accepts an ordinary prefix', async () => {
    const dir = await withTempWorkspace(async (workspace) => workspace.dir, {
      prefix: 'youandfriends-transcode-',
    });
    expect(dir).toContain('youandfriends-transcode-');
  });

  it('has a default budget that bounds a runaway rather than a normal job', () => {
    // A 5 GB original transcoding to AAC needs far less than this; the number exists for the
    // case where ffmpeg produces more than it consumed.
    expect(DEFAULT_TEMP_BUDGET_BYTES).toBeGreaterThanOrEqual(1024 * 1024 * 1024);
  });
});
