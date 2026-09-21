import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StorageDriver, UploadedPart } from '../../driver';
import { assertBucketPrivate, createR2Driver } from '../../r2';
import { createMinioHarness } from '../minio-harness';

const harness = await createMinioHarness();

if (!harness.available) {
  console.warn(`MINIO CONTRACT TESTS SKIPPED — ${harness.skipReason}`);
}

const describeMinio = harness.available ? describe : describe.skip;

function objectKey(label: string): string {
  return `contract/${process.pid}/${label}-${randomUUID()}`;
}

async function putPart(
  driver: StorageDriver,
  key: string,
  uploadId: string,
  partNumber: number,
  bytes: Uint8Array,
): Promise<UploadedPart> {
  const signed = await driver.signPart({ key, uploadId, partNumber });
  const response = await fetch(signed.url, { method: 'PUT', body: bytes });
  expect(response.status, await response.text()).toBe(200);
  const etag = response.headers.get('etag');
  expect(etag).not.toBeNull();
  return { partNumber, etag: etag as string, sizeBytes: bytes.byteLength };
}

function multipartEtag(parts: readonly Uint8Array[]): string {
  const digests = parts.map((part) => createHash('md5').update(part).digest());
  return `"${createHash('md5').update(Buffer.concat(digests)).digest('hex')}-${parts.length}"`;
}

describeMinio('StorageDriver contract against MinIO', () => {
  let driver: StorageDriver;

  beforeAll(async () => {
    await harness.start();
    driver = createR2Driver(harness.config);
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('moves bytes through create, sign, list, complete, head, prefix read, download, stream, and delete', async () => {
    const key = objectKey('round-trip');
    const bytes = new TextEncoder().encode('generated contract bytes, not user music');
    const upload = await driver.createMultipart(key, 'application/octet-stream');
    const uploaded = await putPart(driver, key, upload.uploadId, 1, bytes);

    expect(uploaded.etag).toBe(`"${createHash('md5').update(bytes).digest('hex')}"`);
    expect(await driver.listParts(key, upload.uploadId)).toEqual([uploaded]);
    await driver.completeMultipart(key, upload.uploadId, [uploaded]);

    expect(await driver.head(key)).toMatchObject({
      sizeBytes: bytes.byteLength,
      contentType: 'application/octet-stream',
      etag: multipartEtag([bytes]),
      checksumSha256: undefined,
    });
    expect(await driver.readPrefix(key, 9)).toEqual(bytes.slice(0, 9));

    const download = await driver.signDownload({ key, filename: 'contract.bin' });
    const downloaded = await fetch(download.url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-disposition')).toContain('filename="contract.bin"');
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);

    const stream = await driver.signStream(key);
    const streamed = await fetch(stream.url, { headers: { Range: 'bytes=2-7' } });
    expect(streamed.status).toBe(206);
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(bytes.slice(2, 8));

    await driver.delete([key]);
    await driver.delete([]);
    expect(await driver.head(key)).toBeNull();
    expect(await driver.readPrefix(key, 8)).toEqual(new Uint8Array(0));
  });

  it('accepts out-of-order uploads and completes parts in protocol order', async () => {
    const key = objectKey('out-of-order');
    const firstBytes = new Uint8Array(5 * 1024 * 1024).fill(17);
    const secondBytes = new TextEncoder().encode('last generated part');
    const upload = await driver.createMultipart(key, 'application/octet-stream');

    const second = await putPart(driver, key, upload.uploadId, 2, secondBytes);
    const first = await putPart(driver, key, upload.uploadId, 1, firstBytes);
    await driver.completeMultipart(key, upload.uploadId, [second, first]);

    expect(await driver.head(key)).toMatchObject({
      sizeBytes: firstBytes.length + secondBytes.length,
      etag: multipartEtag([firstBytes, secondBytes]),
    });
    const signed = await driver.signStream(key);
    const firstByte = await fetch(signed.url, { headers: { Range: 'bytes=0-0' } });
    const lastPart = await fetch(signed.url, {
      headers: {
        Range: `bytes=${firstBytes.length}-${firstBytes.length + secondBytes.length - 1}`,
      },
    });
    expect(new Uint8Array(await firstByte.arrayBuffer())).toEqual(new Uint8Array([17]));
    expect(new Uint8Array(await lastPart.arrayBuffer())).toEqual(secondBytes);
  });

  it('uses the last bytes written when a part number is uploaded again', async () => {
    const key = objectKey('reupload');
    const upload = await driver.createMultipart(key, 'application/octet-stream');
    const firstAttempt = new TextEncoder().encode('first generated attempt');
    const replacement = new TextEncoder().encode('replacement generated attempt');

    const stale = await putPart(driver, key, upload.uploadId, 1, firstAttempt);
    const current = await putPart(driver, key, upload.uploadId, 1, replacement);
    expect(current.etag).not.toBe(stale.etag);
    expect(await driver.listParts(key, upload.uploadId)).toEqual([current]);

    await driver.completeMultipart(key, upload.uploadId, [current]);
    const response = await fetch((await driver.signDownload({ key })).url);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(replacement);

    const replay = await driver.signPart({ key, uploadId: upload.uploadId, partNumber: 1 });
    expect((await fetch(replay.url, { method: 'PUT', body: replacement })).status).toBe(404);
    // MinIO treats abort-after-complete as an idempotent no-op rather than NoSuchUpload. That is
    // the observed S3-compatible contract; ADR 0001 records that R2 still needs live verification.
    await expect(driver.abortMultipart(key, upload.uploadId)).resolves.toBeUndefined();
  });

  it('rejects a non-final part smaller than five MiB', async () => {
    const key = objectKey('small-part');
    const upload = await driver.createMultipart(key, 'application/octet-stream');
    const first = await putPart(driver, key, upload.uploadId, 1, new Uint8Array(1024));
    const second = await putPart(driver, key, upload.uploadId, 2, new Uint8Array(1024));

    await expect(
      driver.completeMultipart(key, upload.uploadId, [first, second]),
    ).rejects.toMatchObject({ name: 'EntityTooSmall' });
  });

  it('rejects completion when the manifest names a part that was never uploaded', async () => {
    const key = objectKey('missing-part');
    const upload = await driver.createMultipart(key, 'application/octet-stream');

    await expect(
      driver.completeMultipart(key, upload.uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
      ]),
    ).rejects.toMatchObject({ name: 'InvalidPart' });
  });

  it('rejects a part number above the S3 maximum of 10,000', async () => {
    const key = objectKey('too-many-parts');
    const upload = await driver.createMultipart(key, 'application/octet-stream');
    const maximum = await driver.signPart({ key, uploadId: upload.uploadId, partNumber: 10_000 });
    expect((await fetch(maximum.url, { method: 'PUT', body: new Uint8Array([1]) })).status).toBe(
      200,
    );
    const signed = await driver.signPart({ key, uploadId: upload.uploadId, partNumber: 10_001 });

    const response = await fetch(signed.url, { method: 'PUT', body: new Uint8Array([1]) });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('InvalidArgument');
  });

  it('makes an aborted upload unusable and leaves no object', async () => {
    const key = objectKey('abort');
    const upload = await driver.createMultipart(key, 'application/octet-stream');
    await putPart(driver, key, upload.uploadId, 1, new Uint8Array([1, 2, 3]));
    const signedBeforeAbort = await driver.signPart({
      key,
      uploadId: upload.uploadId,
      partNumber: 1,
    });

    await driver.abortMultipart(key, upload.uploadId);

    await expect(driver.listParts(key, upload.uploadId)).rejects.toMatchObject({
      name: 'NoSuchUpload',
    });
    expect(
      (await fetch(signedBeforeAbort.url, { method: 'PUT', body: new Uint8Array([4]) })).status,
    ).toBe(404);
    expect(await driver.head(key)).toBeNull();
  });

  it("cannot use one session's signed URL to write another session's key", async () => {
    const firstKey = objectKey('isolated-a');
    const secondKey = objectKey('isolated-b');
    const first = await driver.createMultipart(firstKey, 'application/octet-stream');
    const second = await driver.createMultipart(secondKey, 'application/octet-stream');
    const signed = await driver.signPart({
      key: firstKey,
      uploadId: first.uploadId,
      partNumber: 1,
    });
    const substituted = new URL(signed.url);
    expect(substituted.pathname).toContain(firstKey);
    substituted.pathname = substituted.pathname.replace(firstKey, secondKey);

    const refused = await fetch(substituted, { method: 'PUT', body: new Uint8Array([9]) });
    expect(refused.status).toBe(403);
    expect(await driver.listParts(secondKey, second.uploadId)).toEqual([]);

    expect((await fetch(signed.url, { method: 'PUT', body: new Uint8Array([9]) })).status).toBe(
      200,
    );
    await driver.abortMultipart(firstKey, first.uploadId);
    await driver.abortMultipart(secondKey, second.uploadId);
  });

  it('expires part, download, and stream credentials rather than leaving durable access', async () => {
    const key = objectKey('expiry');
    const partKey = objectKey('part-expiry');
    const shortLived = createR2Driver({
      ...harness.config,
      ttls: { downloadSeconds: 1, streamSeconds: 1, partSeconds: 1 },
    });
    const upload = await shortLived.createMultipart(key, 'application/octet-stream');
    const part = await putPart(shortLived, key, upload.uploadId, 1, new Uint8Array([7, 8, 9]));
    await shortLived.completeMultipart(key, upload.uploadId, [part]);
    const partUpload = await shortLived.createMultipart(partKey, 'application/octet-stream');

    const download = await shortLived.signDownload({ key });
    const stream = await shortLived.signStream(key);
    const uploadPart = await shortLived.signPart({
      key: partKey,
      uploadId: partUpload.uploadId,
      partNumber: 1,
    });
    for (const credential of [download, stream, uploadPart]) {
      expect(credential.expiresAt.getTime() - Date.now()).toBeGreaterThan(0);
    }
    expect((await fetch(download.url)).status).toBe(200);
    expect((await fetch(stream.url, { headers: { Range: 'bytes=0-0' } })).status).toBe(206);
    expect(
      (await fetch(uploadPart.url, { method: 'PUT', body: new Uint8Array([4, 5, 6]) })).status,
    ).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(download.url)).status).toBe(403);
    expect((await fetch(stream.url)).status).toBe(403);
    expect(
      (await fetch(uploadPart.url, { method: 'PUT', body: new Uint8Array([7, 8, 9]) })).status,
    ).toBe(403);
  });

  it('confirms the contract bucket has no bucket policy', async () => {
    await expect(assertBucketPrivate(harness.config)).resolves.toBeUndefined();
  });
});
