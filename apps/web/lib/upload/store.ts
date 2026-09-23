import type { UploadableKind } from '@youandfriends/contracts';

import { postJson, RequestFailed } from '@/lib/api/client';

import { UploadRequestError } from './api';
import { browserUploader } from './browser';
import type { MultipartUploader, UploadProgress } from './uploader';

/**
 * The upload queue behind the tray (task `055`): every file being sent, across route changes.
 *
 * A module-level store rather than component state, because the tray lives in the workspace
 * shell beside the player and must outlive whichever page started an upload — navigating away
 * from a song must not cancel its stems. React reads it through `useSyncExternalStore`.
 *
 * Each job is three steps: ask the server for somewhere to put the file (an asset, or the song's
 * mix asset), send the bytes through task `053`'s uploader, and record the finished upload as a
 * version. A retry reuses the asset from the first attempt, so the uploader's persisted state
 * resumes the same session rather than starting a second file.
 */

export type UploadDestination =
  | { readonly type: 'mix'; readonly songId: string; readonly label: string }
  | {
      readonly type: 'asset';
      readonly owner: { readonly songId: string } | { readonly projectId: string };
      readonly kind: UploadableKind;
      readonly folder?: string | undefined;
      readonly label: string;
    };

export type JobState = 'queued' | 'preparing' | UploadProgress['state'] | 'recording';

export interface UploadJob {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly destination: UploadDestination;
  readonly state: JobState;
  readonly uploadedBytes: number;
  /** Smoothed, bytes per second. `null` until there is enough to say. */
  readonly speed: number | null;
  /** Smoothed seconds remaining. `null` until there is enough to say. */
  readonly etaSeconds: number | null;
  /** A failure, split by what the person can do about it. */
  readonly error: { readonly message: string; readonly transient: boolean } | null;
}

interface InternalJob extends UploadJob {
  readonly file: File;
  assetId: string | null;
  uploader: MultipartUploader | null;
  lastSample: { at: number; bytes: number } | null;
  shownAt: number;
}

/** At most this many files move at once; each already runs parallel parts. */
export const MAX_ACTIVE_JOBS = 2;
/** Weight of the newest speed sample. Low, so the estimate settles rather than oscillates. */
const SPEED_SMOOTHING = 0.15;
/** How often the displayed estimate may change — a number that jumps every frame is noise. */
const ESTIMATE_REFRESH_MS = 1000;

export interface UploadQueueDependencies {
  readonly createUploader?: typeof browserUploader;
  readonly post?: typeof postJson;
  readonly now?: () => number;
  /** Told when a job finishes, so the page showing it can refresh. */
  readonly onCompleted?: (job: UploadJob) => void;
}

const ACTIVE: readonly JobState[] = [
  'preparing',
  'hashing',
  'uploading',
  'completing',
  'recording',
];

export function isActive(job: UploadJob): boolean {
  return ACTIVE.includes(job.state);
}

/** Finished uploads and dismissed failures leave; everything else stays until it resolves. */
export function hasUnfinishedWork(jobs: readonly UploadJob[]): boolean {
  return jobs.some((job) => job.state !== 'completed' && job.state !== 'cancelled');
}

export class UploadQueue {
  private jobs: InternalJob[] = [];
  private snapshot: readonly UploadJob[] = [];
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private readonly deps: Required<Omit<UploadQueueDependencies, 'onCompleted'>>;
  private completed: ((job: UploadJob) => void) | undefined;

  constructor(dependencies: UploadQueueDependencies = {}) {
    this.deps = {
      createUploader: dependencies.createUploader ?? browserUploader,
      post: dependencies.post ?? postJson,
      now: dependencies.now ?? (() => Date.now()),
    };
    this.completed = dependencies.onCompleted;
  }

  /** Who to tell when a job finishes. Returns the call that stops telling them. */
  whenCompleted(callback: (job: UploadJob) => void): () => void {
    this.completed = callback;
    return () => {
      if (this.completed === callback) this.completed = undefined;
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly UploadJob[] => this.snapshot;

  private publish() {
    this.snapshot = this.jobs.map((job) => ({
      id: job.id,
      fileName: job.fileName,
      sizeBytes: job.sizeBytes,
      destination: job.destination,
      state: job.state,
      uploadedBytes: job.uploadedBytes,
      speed: job.speed,
      etaSeconds: job.etaSeconds,
      error: job.error,
    }));
    for (const listener of this.listeners) listener();
  }

  private update(id: string, patch: Partial<InternalJob>) {
    this.jobs = this.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
    this.publish();
  }

  private find(id: string): InternalJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  add(files: readonly File[], destination: UploadDestination): string[] {
    const ids = files.map((file) => {
      this.counter += 1;
      const id = `upload-${this.counter}`;
      this.jobs.push({
        id,
        file,
        fileName: file.name,
        sizeBytes: file.size,
        destination,
        state: 'queued',
        uploadedBytes: 0,
        speed: null,
        etaSeconds: null,
        error: null,
        assetId: null,
        uploader: null,
        lastSample: null,
        shownAt: 0,
      });
      return id;
    });
    this.publish();
    this.pump();
    return ids;
  }

  /** Start queued jobs while there is room. */
  private pump() {
    const running = this.jobs.filter((job) => ACTIVE.includes(job.state)).length;
    const next = this.jobs
      .filter((job) => job.state === 'queued')
      .slice(0, MAX_ACTIVE_JOBS - running);
    for (const job of next) void this.run(job.id);
  }

  private async prepare(job: InternalJob): Promise<string> {
    if (job.assetId !== null) return job.assetId;
    const { destination } = job;
    const { assetId } =
      destination.type === 'mix'
        ? await this.deps.post<{ assetId: string }>(
            `/api/songs/${encodeURIComponent(destination.songId)}/versions/prepare`,
          )
        : await this.deps.post<{ assetId: string }>('/api/assets', {
            ...destination.owner,
            kind: destination.kind,
            name: job.fileName,
            ...(destination.folder === undefined ? {} : { folder: destination.folder }),
          });
    this.update(job.id, { assetId });
    return assetId;
  }

  private sample(id: string, progress: UploadProgress) {
    const job = this.find(id);
    if (job === undefined) return;
    const now = this.deps.now();
    let speed = job.speed;
    if (progress.state === 'uploading' && job.lastSample !== null) {
      const seconds = (now - job.lastSample.at) / 1000;
      if (seconds >= 0.25) {
        const instant = Math.max(0, progress.uploadedBytes - job.lastSample.bytes) / seconds;
        speed = speed === null ? instant : speed + SPEED_SMOOTHING * (instant - speed);
      }
    }
    const sampleDue = job.lastSample === null || now - job.lastSample.at >= 250;
    const estimateDue = now - job.shownAt >= ESTIMATE_REFRESH_MS;
    const remaining = progress.totalBytes - progress.uploadedBytes;
    this.update(id, {
      state: progress.state === 'idle' ? 'preparing' : progress.state,
      uploadedBytes: progress.uploadedBytes,
      ...(sampleDue ? { lastSample: { at: now, bytes: progress.uploadedBytes } } : {}),
      ...(estimateDue
        ? {
            speed,
            etaSeconds: speed !== null && speed > 0 ? Math.ceil(remaining / speed) : null,
            shownAt: now,
          }
        : {}),
    });
  }

  private async run(id: string) {
    const job = this.find(id);
    if (job === undefined) return;
    this.update(id, { state: 'preparing', error: null });
    try {
      const assetId = await this.prepare(job);
      const uploader = this.deps.createUploader({ assetId, file: job.file });
      this.update(id, { uploader, lastSample: null });
      uploader.subscribe((progress) => this.sample(id, progress));
      await this.finish(id, uploader, uploader.start());
    } catch (error) {
      this.failWith(id, error);
    } finally {
      this.pump();
    }
  }

  /**
   * Wait for the bytes, then record the version. Shared by a first start and a resume: a paused
   * upload's first run ends when it pauses, so the run that finishes the bytes is the resumed one,
   * and it is the one that must record them.
   */
  private async finish(
    id: string,
    uploader: MultipartUploader,
    sending: Promise<unknown>,
  ): Promise<void> {
    const result = await sending;
    const job = this.find(id);
    if (job === undefined || job.state === 'cancelled') return;
    if (result === null) {
      const after = uploader.progress();
      if (after.state === 'failed') {
        this.fail(id, after.error ?? 'The upload failed.', this.lastErrorTransient(after));
      }
      return;
    }

    this.update(id, { state: 'recording' });
    const sessionId = uploader.session as string;
    const { destination } = job;
    if (destination.type === 'mix') {
      await this.deps.post(`/api/songs/${encodeURIComponent(destination.songId)}/versions`, {
        sessionId,
      });
    } else {
      await this.deps.post(`/api/assets/${encodeURIComponent(job.assetId as string)}/versions`, {
        sessionId,
      });
    }
    this.update(id, { state: 'completed', uploadedBytes: job.sizeBytes, etaSeconds: 0 });
    const done = this.snapshot.find((entry) => entry.id === id);
    if (done !== undefined) this.completed?.(done);
  }

  private failWith(id: string, error: unknown) {
    if (error instanceof RequestFailed) {
      this.fail(id, error.message, error.status === 0 || error.status >= 500);
    } else if (error instanceof UploadRequestError) {
      this.fail(id, error.message, error.transient);
    } else {
      this.fail(id, 'The upload failed.', false);
    }
  }

  /** The uploader retries transient failures itself; one that still failed has run out of tries. */
  private lastErrorTransient(progress: UploadProgress): boolean {
    return /network|timed out|connect/i.test(progress.error ?? '');
  }

  private fail(id: string, message: string, transient: boolean) {
    this.update(id, {
      state: 'failed',
      error: { message, transient },
      speed: null,
      etaSeconds: null,
    });
  }

  pause(id: string) {
    this.find(id)?.uploader?.pause();
  }

  resume(id: string) {
    const job = this.find(id);
    if (job?.state !== 'paused' || job.uploader === null) return;
    const { uploader } = job;
    void this.finish(id, uploader, uploader.resume())
      .catch((error: unknown) => this.failWith(id, error))
      .finally(() => this.pump());
  }

  /** Try a failed job again. Its asset is reused, so persisted parts are picked up. */
  retry(id: string) {
    const job = this.find(id);
    if (job?.state !== 'failed') return;
    this.update(id, { state: 'queued', error: null });
    this.pump();
  }

  async cancel(id: string) {
    const job = this.find(id);
    if (job === undefined) return;
    this.update(id, { state: 'cancelled' });
    await job.uploader?.cancel();
    this.pump();
  }

  /** Forget a finished, cancelled, or failed job. */
  dismiss(id: string) {
    const job = this.find(id);
    if (job === undefined || isActive(job)) return;
    this.jobs = this.jobs.filter((entry) => entry.id !== id);
    this.publish();
  }

  pauseAll() {
    for (const job of this.jobs) if (job.state === 'uploading') this.pause(job.id);
  }

  resumeAll() {
    for (const job of this.jobs) {
      if (job.state === 'paused') this.resume(job.id);
      if (job.state === 'failed') this.retry(job.id);
    }
  }

  async cancelAll() {
    await Promise.all(
      this.jobs.filter((job) => job.state !== 'completed').map((job) => this.cancel(job.id)),
    );
  }

  clearFinished() {
    this.jobs = this.jobs.filter((job) => job.state !== 'completed' && job.state !== 'cancelled');
    this.publish();
  }
}

let shared: UploadQueue | null = null;

/** The one queue for this tab. */
export function uploadQueue(): UploadQueue {
  shared ??= new UploadQueue();
  return shared;
}
