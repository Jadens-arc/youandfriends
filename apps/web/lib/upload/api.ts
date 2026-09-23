import type {
  CompleteUploadRequest,
  CreateUploadRequest,
  ErrorResponse,
  SignedPart,
} from '@youandfriends/contracts';

/**
 * The browser's client for the upload endpoints (task `058`).
 *
 * Every failure is classified here, once, as transient or not — the uploader's retry policy is
 * only as good as this classification. A 404 or a 422 is an answer, not a hiccup: retrying it
 * forever turns an authorization problem into an upload that looks stalled (task `053`'s notes).
 */

export interface OpenedSession {
  readonly id: string;
  readonly partSizeBytes: number;
  readonly partCount: number;
  readonly expiresAt: string;
}

export interface CompletedResult {
  readonly created: boolean;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly checksumSha256: string | null;
}

export interface UploadApi {
  create(request: CreateUploadRequest): Promise<OpenedSession>;
  signParts(sessionId: string, partNumbers: readonly number[]): Promise<SignedPart[]>;
  complete(sessionId: string, request: CompleteUploadRequest): Promise<CompletedResult>;
  abort(sessionId: string): Promise<void>;
}

export class UploadRequestError extends Error {
  constructor(
    message: string,
    /** `0` for a request that never got an answer — offline, DNS, a dropped connection. */
    readonly status: number,
    readonly transient: boolean,
    readonly code?: string | undefined,
  ) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

/** Worth retrying: no answer at all, a timeout, rate limiting, or a server-side failure. */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status !== 501);
}

async function request<T>(
  fetchImpl: typeof fetch,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new UploadRequestError('The network request failed.', 0, true);
  }

  if (!response.ok) {
    let payload: Partial<ErrorResponse> = {};
    try {
      payload = (await response.json()) as Partial<ErrorResponse>;
    } catch {
      // Not JSON — a proxy's HTML error page, say. The status is still the answer.
    }
    throw new UploadRequestError(
      payload.message ?? `Upload request failed (${response.status}).`,
      response.status,
      isTransientStatus(response.status),
      payload.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function httpUploadApi(fetchImpl: typeof fetch = fetch.bind(globalThis)): UploadApi {
  return {
    create: (body) => request(fetchImpl, '/api/uploads', body),
    signParts: async (sessionId, partNumbers) =>
      (
        await request<{ parts: SignedPart[] }>(
          fetchImpl,
          `/api/uploads/${encodeURIComponent(sessionId)}/parts`,
          { partNumbers },
        )
      ).parts,
    complete: (sessionId, body) =>
      request(fetchImpl, `/api/uploads/${encodeURIComponent(sessionId)}/complete`, body),
    abort: (sessionId) =>
      request(fetchImpl, `/api/uploads/${encodeURIComponent(sessionId)}/abort`, undefined),
  };
}

/**
 * Sending one part's bytes to its presigned URL.
 *
 * An interface rather than a direct `XMLHttpRequest` so the uploader's concurrency, retry, and
 * progress logic is testable without a network; {@link xhrPartTransport} is the real one.
 */
export type PartTransport = (
  url: string,
  body: Blob,
  onProgress: (loadedBytes: number) => void,
  signal: AbortSignal,
) => Promise<{ readonly etag: string }>;

/**
 * The real transport. `XMLHttpRequest` rather than `fetch` because only XHR reports upload
 * progress — `fetch` can say when a request finished, not how far through it is.
 *
 * The part's `ETag` comes back as a response header, which a cross-origin response only exposes
 * when the bucket's CORS policy lists it in `ExposeHeaders` (`docs/OPERATIONS.md`). A missing
 * ETag is therefore reported as a configuration problem, not retried.
 */
export const xhrPartTransport: PartTransport = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (etag === null || etag === '') {
          reject(
            new UploadRequestError(
              'Storage did not return an ETag. Its CORS policy must expose the ETag header.',
              xhr.status,
              false,
            ),
          );
          return;
        }
        resolve({ etag });
        return;
      }
      // A 403 from the store is almost always an expired signature; the uploader re-signs.
      reject(
        new UploadRequestError(
          `Storage refused the part (${xhr.status}).`,
          xhr.status,
          isTransientStatus(xhr.status),
          xhr.status === 403 ? 'signature_rejected' : undefined,
        ),
      );
    };
    xhr.onerror = () => reject(new UploadRequestError('The network request failed.', 0, true));
    xhr.ontimeout = () => reject(new UploadRequestError('The part upload timed out.', 408, true));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.send(body);
  });
