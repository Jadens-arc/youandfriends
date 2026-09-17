/**
 * The storage boundary.
 *
 * **This package performs no authorization.** Every method here assumes the caller has already
 * asked `@youandfriends/authz` and been told yes — the driver's job is to talk to the bucket,
 * and a driver that also decided who may read would put two answers to that question in the
 * codebase. It must never be reachable from a route handler directly
 * (`docs/ARCHITECTURE.md` §3); routes go through the upload and download services that own the
 * check.
 *
 * **A presigned URL is a bearer credential.** Anyone holding one has the access it encodes,
 * for as long as it lasts, with no session and no further check. So they are never logged,
 * never written into audit metadata, and never persisted beyond their lifetime
 * (`docs/THREAT_MODEL.md` T3) — and their TTLs are the shortest that still works, which is why
 * {@link PresignTtls} is a policy rather than a constant.
 */

export interface PresignedUrl {
  readonly url: string;
  /** When it stops working. Returned so a caller can decide to re-sign rather than retry. */
  readonly expiresAt: Date;
}

export interface MultipartUpload {
  readonly key: string;
  /** S3's opaque handle for the upload in flight. */
  readonly uploadId: string;
}

export interface UploadedPart {
  readonly partNumber: number;
  readonly etag: string;
  readonly sizeBytes?: number | undefined;
}

export interface ObjectHead {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
  readonly etag: string;
  readonly checksumSha256: string | undefined;
}

export interface SignPartInput {
  readonly key: string;
  readonly uploadId: string;
  readonly partNumber: number;
}

export interface SignDownloadInput {
  readonly key: string;
  /**
   * The filename the browser should save it as.
   *
   * Set as a `Content-Disposition` response header on the signed URL rather than baked into the
   * key — which is the whole reason a user's filename never has to become a key.
   */
  readonly filename?: string | undefined;
}

/**
 * Every operation the product needs from object storage.
 *
 * Stateless and injectable, so a test substitutes an implementation without environment
 * gymnastics and the pipeline never reaches for a global.
 */
export interface StorageDriver {
  createMultipart(key: string, contentType: string): Promise<MultipartUpload>;
  signPart(input: SignPartInput): Promise<PresignedUrl>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipart(key: string, uploadId: string, parts: readonly UploadedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** A URL a browser can download from, with the shortest life that works. */
  signDownload(input: SignDownloadInput): Promise<PresignedUrl>;
  /** A URL an `<audio>` element can stream from. Longer than a download, for a long track. */
  signStream(key: string): Promise<PresignedUrl>;
  /** Metadata, or `null` when the object is not there. Used by reconciliation. */
  head(key: string): Promise<ObjectHead | null>;
  delete(keys: readonly string[]): Promise<void>;
}

/**
 * How long each kind of signed URL lives.
 *
 * Every value is a trade between "the operation completes" and "the credential stops working".
 * They are configurable because the right answer depends on the listener's connection, not on
 * anything knowable here — but the defaults are deliberately the short end of workable.
 */
export interface PresignTtls {
  /** A whole track over a slow connection, plus seeking. */
  readonly streamSeconds: number;
  /** A click-to-save. The browser starts immediately; the URL does not need to outlive that. */
  readonly downloadSeconds: number;
  /** One part of a multipart upload, which may be retried on a poor connection. */
  readonly partSeconds: number;
}

export const DEFAULT_TTLS: PresignTtls = {
  streamSeconds: 15 * 60,
  // Five minutes, not fifteen: a download URL that reaches someone else's chat is a copy of the
  // file, and the window where that works should be as close to the click as possible.
  downloadSeconds: 5 * 60,
  partSeconds: 60 * 60,
};
