import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  assertOverwritable,
  TransferLimitError,
  type ObjectTransfer,
} from '@youandfriends/storage';

/**
 * An `ObjectTransfer` over a local directory, for tests of the pipeline.
 *
 * **Not a stand-in for R2** (CLAUDE.md §7): `createR2Transfer` is what the worker uses, and its
 * round trip is proved against a real S3 server by the storage contract suite. What this replaces
 * is the network, so a test can count exactly which keys were written and how often — the thing
 * a retry test has to observe. It applies the same overwrite guard as the real one.
 */
export interface DirectoryTransfer extends ObjectTransfer {
  readonly root: string;
  /** Every key written, in order, including repeats. */
  readonly uploads: string[];
  readonly downloads: string[];
  put(key: string, bytes: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

export async function directoryTransfer(): Promise<DirectoryTransfer> {
  const root = await mkdtemp(join(tmpdir(), 'jobs-bucket-'));
  const uploads: string[] = [];
  const downloads: string[] = [];
  const pathOf = (key: string) => join(root, ...key.split('/'));

  return {
    root,
    uploads,
    downloads,
    async put(key, bytes) {
      await mkdir(dirname(pathOf(key)), { recursive: true });
      await writeFile(pathOf(key), bytes);
    },
    async has(key) {
      return stat(pathOf(key)).then(
        () => true,
        () => false,
      );
    },
    async downloadToFile(key, path, { maxBytes }) {
      downloads.push(key);
      const { size } = await stat(pathOf(key));
      if (size > maxBytes) throw new TransferLimitError(maxBytes);
      await copyFile(pathOf(key), path);
      return size;
    },
    async uploadFile(key, path) {
      assertOverwritable(key);
      uploads.push(key);
      await mkdir(dirname(pathOf(key)), { recursive: true });
      await copyFile(path, pathOf(key));
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
