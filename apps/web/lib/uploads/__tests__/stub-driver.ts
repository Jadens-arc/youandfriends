import type { ObjectHead, StorageDriver, UploadedPart } from '@youandfriends/storage';

/**
 * A `StorageDriver` that records what it was asked.
 *
 * **Not a mock standing in for the integration** (CLAUDE.md §7). The real R2 driver is what
 * production uses and task `052` runs it against a real server; this exists because the thing
 * under test here is the *verification logic* — that finalize refuses a part the store never
 * saw, an object that is not there, a size over the ceiling — and each of those needs a store
 * that can be made to answer wrongly on purpose. A real bucket cannot be asked to lie.
 */
export interface StubDriver extends StorageDriver {
  /** Keys a multipart upload was opened against. A refusal must leave this untouched. */
  readonly created: string[];
  /**
   * The content type each multipart upload was opened with.
   *
   * Recorded because this is what R2 stores as the object's own `Content-Type` and therefore
   * what it serves the bytes back with — a control the sniffer at finalize cannot reach.
   */
  readonly createdContentTypes: string[];
  readonly signed: { key: string; partNumber: number }[];
  readonly aborted: string[];
  readonly completed: string[];
  /** Every download URL signed, with the filename it was signed for. */
  readonly signedDownloads: { key: string; filename: string | undefined }[];
  parts: UploadedPart[];
  head_: ObjectHead | null;
  /** The bytes `readPrefix` hands back. Defaults to a real WAV header. */
  prefix_: Uint8Array;
  /** What was asked for, so a test can prove the read was ranged rather than whole-object. */
  readonly prefixReads: { key: string; length: number }[];
}

export function stubDriver(overrides: Partial<StubDriver> = {}): StubDriver {
  const created: string[] = [];
  const createdContentTypes: string[] = [];
  const prefixReads: { key: string; length: number }[] = [];
  const signed: { key: string; partNumber: number }[] = [];
  const aborted: string[] = [];
  const completed: string[] = [];
  const signedDownloads: { key: string; filename: string | undefined }[] = [];

  const driver: StubDriver = {
    created,
    createdContentTypes,
    prefixReads,
    signed,
    aborted,
    completed,
    signedDownloads,
    parts: [{ partNumber: 1, etag: 'etag-1', sizeBytes: 5 * 1024 * 1024 }],
    head_: {
      sizeBytes: 5 * 1024 * 1024,
      etag: 'etag-final',
      contentType: 'audio/wav',
      checksumSha256: undefined,
    },
    // A real 44-byte WAV header. The default has to be *something valid*, or every finalize test
    // would quietly assert the unknown-type fallback instead of the path an upload takes.
    prefix_: Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74,
      0x20,
    ]),

    async createMultipart(key, contentType) {
      created.push(key);
      createdContentTypes.push(contentType);
      return { key, uploadId: 'upload-1' };
    },
    async signPart({ key, partNumber }) {
      signed.push({ key, partNumber });
      return { url: `https://bucket.example/${key}?part=${partNumber}`, expiresAt: new Date() };
    },
    async listParts() {
      return driver.parts;
    },
    async completeMultipart(key) {
      completed.push(key);
    },
    async abortMultipart(key) {
      aborted.push(key);
    },
    async signDownload({ key, filename }) {
      signedDownloads.push({ key, filename });
      return { url: `https://bucket.example/${key}`, expiresAt: new Date() };
    },
    async signStream(key) {
      return { url: `https://bucket.example/${key}`, expiresAt: new Date() };
    },
    async readPrefix(key, length) {
      prefixReads.push({ key, length });
      return driver.prefix_.slice(0, length);
    },
    async head() {
      return driver.head_;
    },
    async delete() {},
  };

  return Object.assign(driver, overrides);
}
