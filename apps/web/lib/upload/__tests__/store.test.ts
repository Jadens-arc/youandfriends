import { describe, expect, it, vi } from 'vitest';

import { RequestFailed } from '@/lib/api/client';

import { UploadRequestError } from '../api';
import { MAX_ACTIVE_JOBS, UploadQueue, type UploadJob } from '../store';
import type { MultipartUploader, UploadProgress } from '../uploader';

/**
 * The upload queue behind the tray (task `055`). The uploader itself is task `053`'s and tested
 * there; here a scripted stand-in lets each test decide when bytes finish, pause, or fail.
 */

interface FakeUploader {
  readonly uploader: MultipartUploader;
  emit(progress: Partial<UploadProgress>): void;
  finish(result: 'ok' | 'failed' | 'paused', error?: string): void;
  resumed: number;
}

function fakeUploader(file: File): FakeUploader {
  const listeners = new Set<(progress: UploadProgress) => void>();
  let current: UploadProgress = {
    state: 'idle',
    totalBytes: file.size,
    uploadedBytes: 0,
    hashedBytes: 0,
    completedParts: 0,
    totalParts: 1,
    resumed: false,
  };
  let settle: (value: unknown) => void = () => {};
  const fake: FakeUploader = {
    resumed: 0,
    emit(progress) {
      current = { ...current, ...progress };
      for (const listener of listeners) listener(current);
    },
    finish(result, error) {
      if (result === 'ok') {
        fake.emit({ state: 'completed', uploadedBytes: file.size });
        settle({ created: true });
      } else {
        fake.emit({ state: result, error });
        settle(null);
      }
    },
    uploader: {
      session: 'SESSION1',
      subscribe(listener: (progress: UploadProgress) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      progress: () => current,
      start: () => new Promise((resolve) => (settle = resolve)),
      resume: () => {
        fake.resumed += 1;
        return new Promise((resolve) => (settle = resolve));
      },
      pause: () => fake.emit({ state: 'paused' }),
      cancel: vi.fn(async () => fake.emit({ state: 'cancelled' })),
    } as unknown as MultipartUploader,
  };
  return fake;
}

function harness(now = { value: 0 }) {
  const uploaders: FakeUploader[] = [];
  const posts: [string, unknown][] = [];
  const completed: UploadJob[] = [];
  let assetCounter = 0;
  const post = vi.fn(async (path: string, body?: unknown) => {
    posts.push([path, body]);
    if (path === '/api/assets' || path.endsWith('/versions/prepare')) {
      assetCounter += 1;
      return { assetId: `ASSET${assetCounter}` };
    }
    return {};
  });
  const queue = new UploadQueue({
    createUploader: (target) => {
      const fake = fakeUploader(target.file);
      uploaders.push(fake);
      return fake.uploader;
    },
    post: post as never,
    now: () => now.value,
    onCompleted: (job) => completed.push(job),
  });
  return { queue, uploaders, posts, completed, post };
}

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mix = { type: 'mix', songId: 'S1', label: 'Headlights (new version)' } as const;
const stem = {
  type: 'asset',
  owner: { songId: 'S1' },
  kind: 'stem',
  label: 'Headlights · Stem',
} as const;

describe('UploadQueue', () => {
  it('prepares, uploads, and records a mix as a version of the song', async () => {
    const { queue, uploaders, posts, completed } = harness();
    queue.add([file('mix.wav')], mix);
    await flush();
    uploaders[0]?.finish('ok');
    await flush();
    expect(posts.map(([path]) => path)).toEqual([
      '/api/songs/S1/versions/prepare',
      '/api/songs/S1/versions',
    ]);
    expect(posts[1]?.[1]).toEqual({ sessionId: 'SESSION1' });
    expect(queue.getSnapshot()[0]?.state).toBe('completed');
    expect(completed).toHaveLength(1);
  });

  it('creates an asset of the chosen kind and records the upload against it', async () => {
    const { queue, uploaders, posts } = harness();
    queue.add([file('drums.wav')], { ...stem, folder: 'Stems' });
    await flush();
    uploaders[0]?.finish('ok');
    await flush();
    expect(posts).toEqual([
      ['/api/assets', { songId: 'S1', kind: 'stem', name: 'drums.wav', folder: 'Stems' }],
      ['/api/assets/ASSET1/versions', { sessionId: 'SESSION1' }],
    ]);
  });

  it(`runs at most ${MAX_ACTIVE_JOBS} files at once and starts the next as one finishes`, async () => {
    const { queue, uploaders } = harness();
    queue.add([file('a.wav'), file('b.wav'), file('c.wav')], stem);
    await flush();
    expect(uploaders).toHaveLength(MAX_ACTIVE_JOBS);
    expect(queue.getSnapshot().map((job) => job.state)).toEqual([
      'preparing',
      'preparing',
      'queued',
    ]);
    uploaders[0]?.finish('ok');
    await flush();
    await flush();
    expect(uploaders).toHaveLength(3);
  });

  it('keeps a transient failure and a refusal distinct', async () => {
    const { queue, uploaders, post } = harness();
    queue.add([file('a.wav')], stem);
    await flush();
    uploaders[0]?.finish('failed', 'The network request failed.');
    await flush();
    expect(queue.getSnapshot()[0]?.error).toEqual({
      message: 'The network request failed.',
      transient: true,
    });

    post.mockImplementationOnce(async () => {
      throw new RequestFailed('This workspace does not have room for this file.', 413);
    });
    queue.add([file('b.wav')], stem);
    await flush();
    expect(queue.getSnapshot()[1]?.error).toEqual({
      message: 'This workspace does not have room for this file.',
      transient: false,
    });
  });

  it('retries into the same asset, so persisted parts resume rather than a second file', async () => {
    const { queue, uploaders, posts } = harness();
    queue.add([file('a.wav')], stem);
    await flush();
    uploaders[0]?.finish('failed', 'The network request failed.');
    await flush();
    const [job] = queue.getSnapshot();
    queue.retry(job?.id as string);
    await flush();
    uploaders[1]?.finish('ok');
    await flush();
    expect(posts.filter(([path]) => path === '/api/assets')).toHaveLength(1);
    expect(posts.at(-1)?.[0]).toBe('/api/assets/ASSET1/versions');
    expect(queue.getSnapshot()[0]?.state).toBe('completed');
  });

  it('records the version when a paused upload is resumed and finishes', async () => {
    const { queue, uploaders, posts } = harness();
    queue.add([file('a.wav')], mix);
    await flush();
    const [job] = queue.getSnapshot();
    queue.pause(job?.id as string);
    uploaders[0]?.finish('paused');
    await flush();
    expect(queue.getSnapshot()[0]?.state).toBe('paused');

    queue.resume(job?.id as string);
    expect(uploaders[0]?.resumed).toBe(1);
    uploaders[0]?.finish('ok');
    await flush();
    expect(posts.at(-1)?.[0]).toBe('/api/songs/S1/versions');
    expect(queue.getSnapshot()[0]?.state).toBe('completed');
  });

  it('cancels through the uploader, which aborts the server session', async () => {
    const { queue, uploaders } = harness();
    queue.add([file('a.wav')], stem);
    await flush();
    const [job] = queue.getSnapshot();
    await queue.cancel(job?.id as string);
    expect(uploaders[0]?.uploader.cancel).toHaveBeenCalled();
    expect(queue.getSnapshot()[0]?.state).toBe('cancelled');
  });

  it('smooths speed and refreshes the estimate at most once a second', async () => {
    const clock = { value: 0 };
    const { queue, uploaders } = harness(clock);
    queue.add([file('a.wav', 100_000)], stem);
    await flush();
    const upload = uploaders[0] as FakeUploader;
    upload.emit({ state: 'uploading', uploadedBytes: 0 });
    clock.value = 1000;
    upload.emit({ state: 'uploading', uploadedBytes: 10_000 });
    const first = queue.getSnapshot()[0];
    expect(first?.speed).toBe(10_000);
    expect(first?.etaSeconds).toBe(9);

    // A burst: the instantaneous rate jumps tenfold, the shown rate moves only part of the way.
    clock.value = 1300;
    upload.emit({ state: 'uploading', uploadedBytes: 40_000 });
    expect(queue.getSnapshot()[0]?.speed).toBe(10_000);
    clock.value = 2100;
    upload.emit({ state: 'uploading', uploadedBytes: 50_000 });
    const later = queue.getSnapshot()[0]?.speed ?? 0;
    expect(later).toBeGreaterThan(10_000);
    expect(later).toBeLessThan(40_000);
  });

  it('refuses to dismiss an active job, and forgets a finished one', async () => {
    const { queue, uploaders } = harness();
    queue.add([file('a.wav')], stem);
    await flush();
    const [job] = queue.getSnapshot();
    queue.dismiss(job?.id as string);
    expect(queue.getSnapshot()).toHaveLength(1);
    uploaders[0]?.finish('ok');
    await flush();
    queue.dismiss(job?.id as string);
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('classifies an uploader error thrown outright by its own flag', async () => {
    const { queue, post } = harness();
    post.mockImplementationOnce(async () => {
      throw new UploadRequestError('Storage refused the part (400).', 400, false);
    });
    queue.add([file('a.wav')], stem);
    await flush();
    expect(queue.getSnapshot()[0]?.error?.transient).toBe(false);
  });
});
