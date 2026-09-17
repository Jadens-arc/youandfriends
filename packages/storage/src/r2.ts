import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ServerEnv } from '@youandfriends/config';

import {
  DEFAULT_TTLS,
  type MultipartUpload,
  type ObjectHead,
  type PresignedUrl,
  type PresignTtls,
  type SignDownloadInput,
  type SignPartInput,
  type StorageDriver,
  type UploadedPart,
} from './driver';

/**
 * Cloudflare R2, over the S3 API (ADR 0001).
 *
 * R2 is S3-compatible, not S3. The differences that matter are pinned by task `052`'s contract
 * tests against a real server rather than assumed here — this file is written to the S3 API and
 * the tests are what say which parts of it R2 honours.
 *
 * `region` is `auto` because R2 has no regions but the SDK insists on one, and the endpoint is
 * account-scoped rather than region-scoped.
 */

export interface R2Config {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly ttls?: PresignTtls | undefined;
  /** Injected in tests so expiry assertions are not clock-dependent. */
  readonly now?: (() => Date) | undefined;
}

export class StorageNotConfiguredError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Object storage is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'See the R2 section of .env.example.',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * Read the config for one bucket, or say precisely what is missing.
 *
 * Fails closed and fails **specific**: "storage is not configured" sends someone to check five
 * variables, and naming the absent one is the difference between a minute and an afternoon.
 */
export function r2ConfigFrom(env: ServerEnv, bucketKey: 'originals' | 'derivatives'): R2Config {
  const bucketVar = bucketKey === 'originals' ? 'R2_BUCKET_ORIGINALS' : 'R2_BUCKET_DERIVATIVES';
  const required = {
    R2_ENDPOINT: env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    [bucketVar]: env[bucketVar],
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === '')
    .map(([name]) => name);
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);

  return {
    endpoint: required.R2_ENDPOINT as string,
    accessKeyId: required.R2_ACCESS_KEY_ID as string,
    secretAccessKey: required.R2_SECRET_ACCESS_KEY as string,
    bucket: required[bucketVar] as string,
  };
}

/** The commands this driver presigns. Narrow on purpose: signing anything else is not a thing. */
type SignableCommand = UploadPartCommand | GetObjectCommand;

export function createR2Driver(config: R2Config): StorageDriver {
  const ttls = config.ttls ?? DEFAULT_TTLS;
  const now = config.now ?? (() => new Date());

  const client = new S3Client({
    // R2 has no regions; the SDK requires one, and `auto` is what Cloudflare documents.
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 wants path-style addressing. Virtual-host style resolves to a hostname that does not
    // exist for a custom endpoint.
    forcePathStyle: true,
  });

  /**
   * Sign one command.
   *
   * The cast is the single place the SDK's types are loosened, and it is here rather than in
   * `tsconfig.json`: `@aws-sdk`'s command classes declare optional members without `undefined`,
   * which `exactOptionalPropertyTypes` rejects. Relaxing the flag for the package would give up
   * the check everywhere to satisfy one dependency. The input types are ours and stay strict.
   */
  const sign = async (command: SignableCommand, seconds: number) => {
    const url = await getSignedUrl(client, command as Parameters<typeof getSignedUrl>[1], {
      expiresIn: seconds,
    });
    return { url, expiresAt: new Date(now().getTime() + seconds * 1000) } satisfies PresignedUrl;
  };

  return {
    async createMultipart(key, contentType) {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
        }),
      );
      if (result.UploadId === undefined) {
        // Nothing to abort and nothing to resume: better to fail here than to hand back a
        // handle that every later call will reject.
        throw new Error(`R2 returned no upload id for ${key}`);
      }
      return { key, uploadId: result.UploadId } satisfies MultipartUpload;
    },

    async signPart({ key, uploadId, partNumber }: SignPartInput) {
      return sign(
        new UploadPartCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        ttls.partSeconds,
      );
    },

    async listParts(key, uploadId) {
      const parts: UploadedPart[] = [];
      let marker: number | undefined;

      // Paginated deliberately: an upload can have up to 10,000 parts and the API returns 1,000
      // at a time. Reading only the first page would silently lose the tail of a large upload,
      // and "large" is the case this product is for.
      do {
        const page = await client.send(
          new ListPartsCommand({
            Bucket: config.bucket,
            Key: key,
            UploadId: uploadId,
            ...(marker === undefined ? {} : { PartNumberMarker: String(marker) }),
          }),
        );

        for (const part of page.Parts ?? []) {
          if (part.PartNumber === undefined || part.ETag === undefined) continue;
          parts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            sizeBytes: part.Size,
          });
        }

        marker = page.IsTruncated === true ? Number(page.NextPartNumberMarker) : undefined;
      } while (marker !== undefined && !Number.isNaN(marker));

      return parts;
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            // S3 requires ascending part numbers. The caller may have collected them in
            // completion order, which on a parallel upload is arbitrary.
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
    },

    async abortMultipart(key, uploadId) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    },

    async signDownload({ key, filename }: SignDownloadInput) {
      return sign(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          // The filename rides on the response header rather than in the key, which is what
          // lets keys stay opaque. Quoted and stripped of quotes so a name cannot break out of
          // the header value.
          ...(filename === undefined
            ? {}
            : { ResponseContentDisposition: contentDisposition(filename) }),
        }),
        ttls.downloadSeconds,
      );
    },

    async signStream(key) {
      return sign(new GetObjectCommand({ Bucket: config.bucket, Key: key }), ttls.streamSeconds);
    },

    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          sizeBytes: result.ContentLength ?? 0,
          contentType: result.ContentType,
          etag: result.ETag ?? '',
          checksumSha256: result.ChecksumSHA256,
        } satisfies ObjectHead;
      } catch (error) {
        // Absent is an answer, not a failure — reconciliation asks precisely this question.
        // Anything else is rethrown: swallowing a permissions error as "not there" would make a
        // misconfigured bucket look like an empty one.
        const name = (error as { name?: string }).name;
        if (name === 'NotFound' || name === 'NoSuchKey') return null;
        throw error;
      }
    },

    async delete(keys) {
      if (keys.length === 0) return;
      // `DeleteObjects` takes 1,000 at a time.
      for (let index = 0; index < keys.length; index += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) },
          }),
        );
      }
    },
  };
}

/**
 * A `Content-Disposition` value that a filename cannot break out of.
 *
 * Quotes and backslashes are escaped, control characters and newlines removed — a newline would
 * let a name inject a second header. The `filename*` form carries the original as UTF-8 for
 * browsers that read it, while `filename` keeps an ASCII fallback for those that do not.
 */
export function contentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = filename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  const quoted = clean.replace(/["\\]/g, '\\$&');
  const ascii = clean.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '\\$&');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(quoted)}`;
}

/**
 * Confirm a bucket has no public policy, at startup.
 *
 * `docs/THREAT_MODEL.md` T3: the buckets are private, and "we set it in the console" is a claim
 * about somebody's memory. This asks the bucket. A policy that exists at all is reported rather
 * than parsed — any public policy on a bucket holding unreleased music is a finding, and a
 * parser deciding which ones are benign is a parser that will one day be wrong.
 */
export async function assertBucketPrivate(config: R2Config): Promise<void> {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

  try {
    const result = await client.send(new GetBucketPolicyCommand({ Bucket: config.bucket }));
    if (result.Policy !== undefined && result.Policy !== '') {
      throw new Error(
        `Bucket ${config.bucket} has a bucket policy. Buckets holding user music are private ` +
          'with no public policy (THREAT_MODEL T3); review it before serving traffic.',
      );
    }
  } catch (error) {
    // No policy at all is the expected, correct state and is reported as an error by S3.
    const name = (error as { name?: string }).name;
    if (name === 'NoSuchBucketPolicy') return;
    throw error;
  }
}
