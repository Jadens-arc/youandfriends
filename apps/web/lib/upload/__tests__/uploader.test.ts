import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { backoffDelay, DEFAULT_RETRY, MultipartUploader, type UploadProgress } from '../uploader';
import { indexedDbUploadStore, memoryUploadStore, type UploadStore } from '../persistence';
import { UploadRequestError } from '../api';

import { fakeServer, fileOf, instantHasher, MIB, noSleep, refused, transient } from './harness';

function uploader(
  file: File,
  server: ReturnType<typeof fakeServer>,
  store: UploadStore = memoryUploadStore(),
  options: { concurrency?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  return new MultipartUploader(
    { assetId: 'ASSET1', file },
    {
      api: server.api,
      transport: server.transport,
      hasher: instantHasher,
      store,
      concurrency: options.concurrency ?? 4,
      sleep: options.sleep ?? noSleep,
      random: () => 0.5,
    },
  );
}

describe('MultipartUploader', () => {
  it('uploads every part once and completes with them in order', async () => {
    const server = fakeServer();
    const file = fileOf(23 * MIB);
    const result = await uploader(file, server).start();

    expect(result).toMatchObject({ created: true, sizeBytes: file.size });
    expect([...server.put].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(server.calls.complete).toBe(1);
  });

  it('never runs more parts at once than its concurrency allows', async () => {
    const server = fakeServer();
    await uploader(fileOf(60 * MIB), server, memoryUploadStore(), { concurrency: 3 }).start();
    expect(server.put).toHaveLength(12);
    expect(server.maxConcurrent).toBe(3);
  });

  it('reports progress that only moves forward and ends exactly at the total', async () => {
    const server = fakeServer();
    const file = fileOf(21 * MIB);
    const upload = uploader(file, server, memoryUploadStore(), { concurrency: 1 });
    const seen: UploadProgress[] = [];
    upload.subscribe((progress) => seen.push(progress));
    await upload.start();

    const uploading = seen.filter((p) => p.state === 'uploading').map((p) => p.uploadedBytes);
    for (let index = 1; index < uploading.length; index += 1) {
      expect(uploading[index]).toBeGreaterThanOrEqual(uploading[index - 1] ?? 0);
    }
    // Per-part granularity: the half-way report inside a part is visible, not just part ends.
    expect(uploading).toContain(Math.floor((5 * MIB) / 2));
    const last = seen.at(-1);
    expect(last).toMatchObject({ state: 'completed', uploadedBytes: file.size, completedParts: 5 });
    expect(seen.some((p) => p.state === 'hashing')).toBe(true);
  });

  it('retries a transient failure with backoff, and does not resend finished parts', async () => {
    const server = fakeServer();
    server.failPart(2, 2, transient);
    const delays: number[] = [];
    const result = await uploader(fileOf(15 * MIB), server, memoryUploadStore(), {
      concurrency: 1,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }).start();

    expect(result?.created).toBe(true);
    expect(server.put).toEqual([1, 2, 3]);
    expect(delays).toEqual([
      backoffDelay(0, DEFAULT_RETRY, () => 0.5),
      backoffDelay(1, DEFAULT_RETRY, () => 0.5),
    ]);
    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
  });

  it('surfaces a non-transient failure at once, without retrying it', async () => {
    const server = fakeServer();
    server.failPart(1, 1, refused);
    const upload = uploader(fileOf(6 * MIB), server, memoryUploadStore(), { concurrency: 1 });
    const result = await upload.start();

    expect(result).toBeNull();
    expect(upload.progress()).toMatchObject({ state: 'failed', error: 'Not found.' });
    expect(server.put).toEqual([]);
    expect(server.calls.complete).toBe(0);
  });

  it('gives up on a transient failure after the retry budget', async () => {
    const server = fakeServer();
    server.failPart(1, 100, transient);
    const upload = uploader(fileOf(6 * MIB), server);
    await upload.start();
    expect(upload.progress().state).toBe('failed');
  });

  it('re-signs once when the store rejects an expired signature', async () => {
    const server = fakeServer();
    server.failPart(
      1,
      1,
      () => new UploadRequestError('Storage refused', 403, false, 'signature_rejected'),
    );
    const result = await uploader(fileOf(3 * MIB), server).start();
    expect(result?.created).toBe(true);
    expect(server.calls.sign.filter((batch) => batch.includes(1))).toHaveLength(2);
  });

  it('pauses without losing confirmed parts, and resumes from them', async () => {
    const server = fakeServer();
    const upload = uploader(fileOf(20 * MIB), server, memoryUploadStore(), { concurrency: 1 });
    // Let part 1 through, then hold part 2 in flight and pause — on the event, not on a timer,
    // so a slow machine cannot pause before part 1 has landed.
    let held = false;
    const partOneLanded = new Promise<void>((resolve) => {
      upload.subscribe((progress) => {
        if (progress.completedParts === 1 && !held) {
          held = true;
          server.hold();
          resolve();
        }
      });
    });
    const first = upload.start();
    await partOneLanded;
    upload.pause();
    expect(await first).toBeNull();
    expect(upload.progress()).toMatchObject({ state: 'paused', completedParts: 1 });

    server.release();
    const result = await upload.resume();
    expect(result?.created).toBe(true);
    // Part 1 was never sent twice.
    expect(server.put.filter((part) => part === 1)).toHaveLength(1);
    expect(server.calls.create).toBe(1);
  });

  it('resumes after a reload from persisted state, for the same file only', async () => {
    const server = fakeServer();
    const store = indexedDbUploadStore();
    const file = fileOf(20 * MIB);

    // The first page load confirms two parts, then the part-3 PUT is refused by the store —
    // not a 404 from our server, which would mean the session itself is gone.
    server.failPart(
      3,
      1,
      () => new UploadRequestError('Storage refused the part (400).', 400, false),
    );
    await uploader(file, server, store, { concurrency: 1 }).start();
    expect(server.put).toEqual([1, 2]);
    const saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    // No presigned URL ever reaches disk.
    expect(JSON.stringify(saved)).not.toMatch(/https?:|sig=/);

    // A new page load, a new uploader, the same file: parts 1 and 2 are not sent again.
    const again = uploader(file, server, store, { concurrency: 1 });
    const result = await again.start();
    expect(result?.created).toBe(true);
    expect(again.progress().resumed).toBe(true);
    expect(server.put).toEqual([1, 2, 3, 4]);
    expect(server.calls.create).toBe(1);
    expect(await store.list()).toEqual([]);

    // A different file under the same name starts over.
    const edited = fileOf(20 * MIB, 'Blue Hour.wav', 1_800_000_000_000);
    server.failPart(1, 1, refused);
    await uploader(edited, server, store).start();
    expect(server.calls.create).toBe(2);
  });

  it('cancels by aborting the server session and forgetting local state', async () => {
    const server = fakeServer();
    const store = memoryUploadStore();
    const upload = uploader(fileOf(20 * MIB), server, store, { concurrency: 1 });
    server.hold();
    const uploading = new Promise<void>((resolve) => {
      upload.subscribe((progress) => {
        if (progress.state === 'uploading') resolve();
      });
    });
    const running = upload.start();
    await uploading;
    await upload.cancel();

    expect(await running).toBeNull();
    expect(server.calls.abort).toEqual(['SESSION1']);
    expect(upload.progress().state).toBe('cancelled');
    expect(await store.list()).toEqual([]);
    expect(server.calls.complete).toBe(0);
  });

  it('forgets a session the server no longer has, so the next attempt starts clean', async () => {
    const server = fakeServer();
    const store = memoryUploadStore();
    server.api.complete = async () => {
      throw new UploadRequestError('This upload has expired.', 410, false);
    };
    const upload = uploader(fileOf(6 * MIB), server, store);
    await upload.start();
    expect(upload.progress().state).toBe('failed');
    expect(await store.list()).toEqual([]);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially, stays under the cap, and is jittered into the upper half', () => {
    expect(backoffDelay(0, DEFAULT_RETRY, () => 0)).toBe(250);
    expect(backoffDelay(0, DEFAULT_RETRY, () => 1)).toBe(500);
    expect(backoffDelay(3, DEFAULT_RETRY, () => 1)).toBe(4000);
    expect(backoffDelay(20, DEFAULT_RETRY, () => 1)).toBe(DEFAULT_RETRY.maxDelayMs);
  });
});
