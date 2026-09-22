import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import type { R2Config } from '../r2';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:19000';
const TEST_ACCESS_KEY = ['youandfriends', 'test'].join('-');
const TEST_SECRET_KEY = ['minio', 'contract', 'test', 'only'].join('-');
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function managedMinioEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    YOUANDFRIENDS_MINIO_ENDPOINT: DEFAULT_ENDPOINT,
    YOUANDFRIENDS_MINIO_ACCESS_KEY: TEST_ACCESS_KEY,
    YOUANDFRIENDS_MINIO_SECRET_KEY: TEST_SECRET_KEY,
    YOUANDFRIENDS_MINIO_REQUIRED: '1',
  };
}

export interface MinioHarness {
  readonly available: boolean;
  readonly skipReason: string | undefined;
  readonly config: R2Config;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function localEndpoint(): string {
  const endpoint = process.env.YOUANDFRIENDS_MINIO_ENDPOINT ?? DEFAULT_ENDPOINT;
  const url = new URL(endpoint);
  if (url.username !== '' || url.password !== '') {
    throw new Error('Refusing a MinIO endpoint containing credentials');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error(
      `Refusing to run storage contract tests against non-local endpoint ${url.hostname}`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing MinIO endpoint protocol ${url.protocol}`);
  }
  return url.origin;
}

function compose(args: readonly string[]): void {
  const result = spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', ...args], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed with status ${String(result.status)}`);
  }
}

export function startMinioService(): void {
  compose(['up', '-d', '--wait']);
}

export function stopMinioService(): void {
  compose(['down', '-v']);
}

function clientFor(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

async function isReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/minio/health/ready`, {
      signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function emptyBucket(client: S3Client, bucket: string): Promise<void> {
  while (true) {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const objects = (page.Contents ?? [])
      .map(({ Key }) => Key)
      .filter((key): key is string => key !== undefined)
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    if (objects.length === 0) break;
  }

  while (true) {
    const uploads = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
    const abortable = (uploads.Uploads ?? []).filter(
      (upload): upload is typeof upload & { Key: string; UploadId: string } =>
        upload.Key !== undefined && upload.UploadId !== undefined,
    );
    for (const upload of abortable) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
    if (abortable.length === 0) break;
  }
}

export async function createMinioHarness(): Promise<MinioHarness> {
  const endpoint = localEndpoint();
  const available = await isReady(endpoint);
  if (!available && process.env.YOUANDFRIENDS_MINIO_REQUIRED === '1') {
    throw new Error(`Managed MinIO contract service is unavailable at ${endpoint}`);
  }
  const bucket = `youandfriends-contract-${randomUUID()}`;
  const config: R2Config = {
    endpoint,
    accessKeyId: process.env.YOUANDFRIENDS_MINIO_ACCESS_KEY ?? TEST_ACCESS_KEY,
    secretAccessKey: process.env.YOUANDFRIENDS_MINIO_SECRET_KEY ?? TEST_SECRET_KEY,
    bucket,
  };
  const client = clientFor(config);

  return {
    available,
    skipReason: available
      ? undefined
      : `MinIO unavailable at ${endpoint}; start it with docker compose -f docker-compose.test.yml up -d`,
    config,
    async start() {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    },
    async stop() {
      try {
        await emptyBucket(client, bucket);
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      } finally {
        client.destroy();
      }
    },
  };
}
