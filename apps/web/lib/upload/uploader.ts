import type { UploadedPart } from '@youandfriends/storage';

import {
  UploadRequestError,
  type CompletedResult,
  type PartTransport,
  type UploadApi,
} from './api';
import type { Hasher } from './checksum';
import { planParts, type PartPlan } from './chunker';
import { uploadFingerprint, type PersistedUpload, type UploadStore } from './persistence';

/**
 * The browser's multipart uploader (task `053`): chunking, bounded parallel parts, progress,
 * pause, resume across a reload, cancel, and retry with backoff.
 *
 * The client is untrusted and this file enforces nothing — every guarantee is the server's
 * (task `051`). What it owns is getting 2 GB across a bad connection without making the person
 * start over: a part that fails is retried, a paused upload keeps the parts it finished, and a
 * reload picks up from the last confirmed part rather than byte zero.
 */

export type UploadState =
  'idle' | 'hashing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'cancelled' | 'failed';

export interface UploadProgress {
  readonly state: UploadState;
  readonly totalBytes: number;
  /** Bytes confirmed by the store plus bytes in flight right now. Never goes past `totalBytes`. */
  readonly uploadedBytes: number;
  /** Bytes hashed so far, while `state` is `hashing`. */
  readonly hashedBytes: number;
  readonly completedParts: number;
  readonly totalParts: number;
  /** True when this upload picked up a session from an earlier page load. */
  readonly resumed: boolean;
  /** Present when `state` is `failed`: a sentence for a person, not a stack trace. */
  readonly error?: string | undefined;
}

export interface RetryPolicy {
  /** Attempts per part, including the first. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 6, baseDelayMs: 500, maxDelayMs: 30_000 };

/** Four to six concurrent parts is the task's starting point; four leaves room for the page. */
export const DEFAULT_CONCURRENCY = 4;

/** Re-sign a URL this long before it expires, rather than finding out from a 403 mid-part. */
const RESIGN_MARGIN_MS = 60_000;
/** How many part URLs to ask for at once. The endpoint accepts up to 100. */
const SIGN_BATCH = 20;

export interface UploaderOptions {
  readonly api: UploadApi;
  readonly transport: PartTransport;
  readonly hasher: Hasher;
  readonly store: UploadStore;
  readonly concurrency?: number;
  readonly retry?: RetryPolicy;
  /** Injected so tests control time; production uses the real clock and `setTimeout`. */
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

export interface UploadTarget {
  readonly assetId: string;
  readonly file: File;
  /** Sent as the content-type hint. The server derives the real type from the bytes. */
  readonly contentTypeHint?: string;
}

/**
 * Exponential backoff with jitter: `base · 2^attempt`, capped, then scaled into [50%, 100%] so a
 * room full of uploads that failed together does not retry together.
 */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** A sentence for a person. Never the raw error, which may carry a URL. */
function describe(error: unknown): string {
  if (error instanceof UploadRequestError) return error.message;
  return 'The upload failed. Try again.';
}

interface SignedUrl {
  readonly url: string;
  readonly expiresAt: number;
}

export class MultipartUploader {
  private readonly options: Required<Omit<UploaderOptions, 'concurrency' | 'retry'>> & {
    concurrency: number;
    retry: RetryPolicy;
  };
  private readonly listeners = new Set<(progress: UploadProgress) => void>();

  private state: UploadState = 'idle';
  private error: string | undefined;
  private resumed = false;
  private hashedBytes = 0;
  private sessionId: string | null = null;
  private record: PersistedUpload | null = null;
  private plan: PartPlan[] = [];
  private readonly done = new Map<number, UploadedPart>();
  private readonly inFlight = new Map<number, number>();
  /** In memory only — see `persistence.ts` on why a URL never reaches disk. */
  private readonly urls = new Map<number, SignedUrl>();
  private controller = new AbortController();
  private running: Promise<CompletedResult | null> | null = null;

  constructor(
    private readonly target: UploadTarget,
    options: UploaderOptions,
  ) {
    this.options = {
      now: () => Date.now(),
      sleep: defaultSleep,
      random: Math.random,
      ...options,
      concurrency: Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
      retry: options.retry ?? DEFAULT_RETRY,
    };
  }

  /** The server session, once opened — what the caller records the finished upload against. */
  get session(): string | null {
    return this.sessionId;
  }

  get fingerprint(): string {
    return uploadFingerprint(this.target.assetId, this.target.file);
  }

  subscribe(listener: (progress: UploadProgress) => void): () => void {
    this.listeners.add(listener);
    listener(this.progress());
    return () => this.listeners.delete(listener);
  }

  progress(): UploadProgress {
    const confirmed = [...this.done.values()].reduce((sum, part) => sum + (part.sizeBytes ?? 0), 0);
    const flying = [...this.inFlight.values()].reduce((sum, bytes) => sum + bytes, 0);
    return {
      state: this.state,
      totalBytes: this.target.file.size,
      uploadedBytes: Math.min(this.target.file.size, confirmed + flying),
      hashedBytes: this.hashedBytes,
      completedParts: this.done.size,
      totalParts: this.plan.length,
      resumed: this.resumed,
      error: this.error,
    };
  }

  private emit() {
    const snapshot = this.progress();
    for (const listener of this.listeners) listener(snapshot);
  }

  private setState(state: UploadState, error?: string) {
    this.state = state;
    this.error = error;
    this.emit();
  }

  /** Start, or pick up where an earlier page load left off. Resolves when it stops for any reason. */
  start(): Promise<CompletedResult | null> {
    if (this.running !== null) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stop sending, keep every confirmed part. In-flight parts restart from their beginning. */
  pause(): void {
    if (this.state !== 'uploading' && this.state !== 'hashing') return;
    this.controller.abort();
    this.inFlight.clear();
    this.setState('paused');
  }

  resume(): Promise<CompletedResult | null> {
    if (this.state !== 'paused' && this.state !== 'failed') {
      return this.running ?? Promise.resolve(null);
    }
    // The paused run may still be unwinding its aborted requests; let it finish first, so the
    // new run does not share state with the old one's last moments.
    const previous = this.running ?? Promise.resolve(null);
    return previous.then(() => {
      this.controller = new AbortController();
      return this.start();
    });
  }

  /**
   * Stop and tell the server. A local-only cancel leaves the parts billed in the bucket until the
   * sweep finds them (`docs/OPERATIONS.md` §2), so the abort call is the point of this method.
   */
  async cancel(): Promise<void> {
    this.controller.abort();
    this.inFlight.clear();
    const sessionId = this.sessionId;
    this.setState('cancelled');
    await this.options.store.delete(this.fingerprint);
    if (sessionId !== null) {
      try {
        await this.options.api.abort(sessionId);
      } catch (error) {
        // Already finished, expired, or gone: nothing left to abort. Anything else is reported,
        // because a failed abort is exactly the billed-residue case.
        if (!(error instanceof UploadRequestError) || error.status >= 500 || error.status === 0) {
          throw error;
        }
      }
    }
  }

  private async run(): Promise<CompletedResult | null> {
    const signal = this.controller.signal;
    try {
      if (this.sessionId === null) await this.open(signal);
      if (signal.aborted) return null;

      this.setState('uploading');
      await this.sendAll(signal);
      if (signal.aborted) return null;

      this.setState('completing');
      const parts = [...this.done.values()].sort((a, b) => a.partNumber - b.partNumber);
      const result = await this.options.api.complete(this.sessionId as string, {
        parts: parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
          sizeBytes: part.sizeBytes ?? 0,
        })),
      });
      await this.options.store.delete(this.fingerprint);
      this.setState('completed');
      return result;
    } catch (error) {
      if (isAbort(error) || signal.aborted) return null;
      // A session the server no longer recognises cannot be resumed; forget it so the next
      // attempt starts clean instead of failing the same way forever.
      if (
        error instanceof UploadRequestError &&
        (error.status === 404 || error.status === 409 || error.status === 410)
      ) {
        await this.options.store.delete(this.fingerprint);
        this.sessionId = null;
        this.done.clear();
      }
      this.setState('failed', describe(error));
      return null;
    }
  }

  /** Resume a persisted session for this exact file, or hash it and open a new one. */
  private async open(signal: AbortSignal) {
    const { file, assetId } = this.target;
    const existing = await this.options.store.get(this.fingerprint);
    if (existing !== null && Date.parse(existing.expiresAt) > this.options.now()) {
      this.record = existing;
      this.sessionId = existing.sessionId;
      this.plan = planParts(file.size, existing.partSizeBytes);
      for (const part of existing.parts) this.done.set(part.partNumber, part);
      this.resumed = true;
      return;
    }
    if (existing !== null) await this.options.store.delete(this.fingerprint);

    this.setState('hashing');
    const checksum = await this.options.hasher(
      file,
      (hashedBytes) => {
        this.hashedBytes = hashedBytes;
        this.emit();
      },
      signal,
    );
    if (signal.aborted) return;

    const session = await this.options.api.create({
      assetId: assetId as never,
      sizeBytes: file.size,
      contentTypeHint: this.target.contentTypeHint || file.type || 'application/octet-stream',
      filename: file.name,
      expectedChecksumSha256: checksum,
    });
    this.sessionId = session.id;
    this.plan = planParts(file.size, session.partSizeBytes);
    this.record = {
      fingerprint: this.fingerprint,
      sessionId: session.id,
      assetId,
      fileName: file.name,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      partSizeBytes: session.partSizeBytes,
      checksumSha256: checksum,
      parts: [],
      expiresAt: session.expiresAt,
    };
    await this.options.store.put(this.record);
  }

  private async persistDone() {
    if (this.record === null) return;
    this.record = {
      ...this.record,
      parts: [...this.done.values()].sort((a, b) => a.partNumber - b.partNumber),
    };
    await this.options.store.put(this.record);
  }

  /** A pool of `concurrency` workers pulling from one queue of parts not yet confirmed. */
  private async sendAll(signal: AbortSignal) {
    const queue = this.plan.filter((part) => !this.done.has(part.partNumber));
    let failure: unknown = null;

    const worker = async () => {
      while (failure === null && !signal.aborted) {
        const part = queue.shift();
        if (part === undefined) return;
        try {
          await this.sendPart(part, queue, signal);
        } catch (error) {
          failure ??= error;
        }
      }
    };

    await Promise.all(Array.from({ length: this.options.concurrency }, () => worker()));
    if (failure !== null) throw failure;
  }

  private async urlFor(part: PartPlan, upcoming: readonly PartPlan[]): Promise<string> {
    const cached = this.urls.get(part.partNumber);
    if (cached !== undefined && cached.expiresAt - RESIGN_MARGIN_MS > this.options.now()) {
      return cached.url;
    }
    // Sign this part and the next few in one round trip.
    const batch = [part, ...upcoming]
      .filter((candidate) => {
        const url = this.urls.get(candidate.partNumber);
        return url === undefined || url.expiresAt - RESIGN_MARGIN_MS <= this.options.now();
      })
      .slice(0, SIGN_BATCH)
      .map((candidate) => candidate.partNumber);
    const signed = await this.options.api.signParts(this.sessionId as string, batch);
    for (const entry of signed) {
      this.urls.set(entry.partNumber, { url: entry.url, expiresAt: Date.parse(entry.expiresAt) });
    }
    const url = this.urls.get(part.partNumber);
    if (url === undefined) throw new UploadRequestError('A part could not be signed.', 500, true);
    return url.url;
  }

  private async sendPart(part: PartPlan, upcoming: readonly PartPlan[], signal: AbortSignal) {
    const { retry, random, sleep } = this.options;
    const body = this.target.file.slice(part.start, part.end);
    let resigned = false;

    for (let attempt = 0; ; attempt += 1) {
      try {
        const url = await this.urlFor(part, upcoming);
        const { etag } = await this.options.transport(
          url,
          body,
          (loaded) => {
            this.inFlight.set(part.partNumber, Math.min(loaded, body.size));
            this.emit();
          },
          signal,
        );
        this.inFlight.delete(part.partNumber);
        this.done.set(part.partNumber, {
          partNumber: part.partNumber,
          etag,
          sizeBytes: part.end - part.start,
        });
        await this.persistDone();
        this.emit();
        return;
      } catch (error) {
        this.inFlight.delete(part.partNumber);
        if (isAbort(error) || signal.aborted) throw error;

        // An expired or rejected signature: forget the URL and sign again, once, straight away.
        if (
          error instanceof UploadRequestError &&
          error.code === 'signature_rejected' &&
          !resigned
        ) {
          resigned = true;
          this.urls.delete(part.partNumber);
          continue;
        }

        const transient = error instanceof UploadRequestError && error.transient;
        if (!transient || attempt + 1 >= retry.maxAttempts) throw error;
        await sleep(backoffDelay(attempt, retry, random), signal);
      }
    }
  }
}
