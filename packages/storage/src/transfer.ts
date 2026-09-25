import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { parseObjectKey } from './keys';
import type { R2Config } from './r2';

/**
 * Whole-object reads and writes, for the media worker (task `064`).
 *
 * Separate from `StorageDriver` on purpose. The web tier signs URLs and never moves bytes itself;
 * this is the one place a process holds an object's bytes, and giving it its own narrow
 * interface keeps "which code can write to the bucket directly" a short list.
 */
export interface ObjectTransfer {
  /**
   * Stream an object to a local file. Refuses — and removes the partial file — once more than
   * `maxBytes` arrive, so a mislabelled object cannot fill a worker's disk.
   */
  downloadToFile(key: string, path: string, options: TransferOptions): Promise<number>;
  /**
   * Write a local file to `key`, replacing whatever is there. **Refuses an original's key**:
   * derivatives are regenerable and may be overwritten by a retry; originals are sacred.
   */
  uploadFile(
    key: string,
    path: string,
    contentType: string,
    options?: Omit<TransferOptions, 'maxBytes'>,
  ): Promise<void>;
}

export interface TransferOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
}

export class TransferLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`object exceeded its ${limitBytes} byte limit while downloading`);
    this.name = 'TransferLimitError';
  }
}

/** Throws unless `key` is safe to overwrite. Exported so the in-process test transfer shares it. */
export function assertOverwritable(key: string): void {
  const parsed = parseObjectKey(key);
  if (parsed === null) throw new Error(`refusing to write ${key}: not a key this product issued`);
  if (parsed.objectClass === 'original') {
    throw new Error(`refusing to write ${key}: originals are never overwritten`);
  }
}

/** A byte counter that fails the stream past a limit rather than after the fact. */
export function limitBytes(limit: number): Transform & { readonly count: () => number } {
  let seen = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.byteLength;
      if (seen > limit) callback(new TransferLimitError(limit));
      else callback(null, chunk);
    },
  });
  return Object.assign(transform, { count: () => seen });
}

export function createR2Transfer(config: R2Config): ObjectTransfer {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

  return {
    async downloadToFile(key, path, { maxBytes, signal }) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        signal === undefined ? {} : { abortSignal: signal },
      );
      if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
        throw new TransferLimitError(maxBytes);
      }
      const body = result.Body;
      if (!(body instanceof Readable)) throw new Error(`no readable body for ${key}`);
      const counter = limitBytes(maxBytes);
      try {
        await pipeline(
          body,
          counter,
          createWriteStream(path, { flags: 'wx' }),
          ...(signal === undefined ? [] : [{ signal }]),
        );
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      }
      return counter.count();
    },

    async uploadFile(key, path, contentType, options = {}) {
      assertOverwritable(key);
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: contentType,
        }),
        options.signal === undefined ? {} : { abortSignal: options.signal },
      );
    },
  };
}
