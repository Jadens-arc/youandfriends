import { createHash } from 'node:crypto';

import { MAX_PARTS, MIN_PART_SIZE_BYTES, partSizeFor } from '@youandfriends/contracts';
import { describe, expect, it, vi } from 'vitest';

import { httpUploadApi, isTransientStatus, UploadRequestError } from '../api';
import { hashBlob } from '../checksum';
import { InvalidPartPlanError, planParts } from '../chunker';
import { assertNoCredentials, memoryUploadStore, uploadFingerprint } from '../persistence';

import { bytesOf, fileOf, MIB } from './harness';

describe('planParts', () => {
  it('covers every byte exactly once, in order', () => {
    const parts = planParts(23 * MIB + 7, 5 * MIB);
    expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 5 * MIB });
    expect(parts.at(-1)).toEqual({ partNumber: 5, start: 20 * MIB, end: 23 * MIB + 7 });
    for (let index = 1; index < parts.length; index += 1) {
      expect(parts[index]?.start).toBe(parts[index - 1]?.end);
    }
  });

  it('accepts the server plan for a 2 GB master and for a tiny file', () => {
    const big = 2 * 1024 * MIB;
    const parts = planParts(big, partSizeFor(big));
    expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
    expect(parts.length).toBeLessThanOrEqual(500);
    expect(planParts(10, partSizeFor(10))).toHaveLength(1);
  });

  it('refuses a plan S3 would reject at the very end', () => {
    expect(() => planParts(10 * MIB, MIN_PART_SIZE_BYTES - 1)).toThrow(InvalidPartPlanError);
    expect(() => planParts(MAX_PARTS * 5 * MIB + 1, 5 * MIB)).toThrow(/ceiling/);
    expect(() => planParts(0, 5 * MIB)).toThrow(InvalidPartPlanError);
  });
});

describe('hashBlob', () => {
  it('matches a one-shot SHA-256 across slice boundaries', async () => {
    const file = fileOf(17 * MIB + 3);
    const progress: number[] = [];
    const digest = await hashBlob(file, (bytes) => progress.push(bytes));
    const expected = createHash('sha256').update(bytesOf(file.size)).digest('hex');
    expect(digest).toBe(expected);
    expect(progress.at(-1)).toBe(file.size);
    expect(progress).toHaveLength(3);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(hashBlob(fileOf(MIB), () => {}, controller.signal)).rejects.toThrow('Aborted');
  });
});

describe('the upload API client', () => {
  it('classifies failures once: transient is retried, an answer is not', () => {
    expect([0, 408, 429, 500, 502, 503].every(isTransientStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 410, 413, 422, 501].some(isTransientStatus)).toBe(false);
  });

  it('turns a refusal into an UploadRequestError with the server’s message', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 }),
    );
    const api = httpUploadApi(fetchImpl as unknown as typeof fetch);
    const error = await api.abort('S1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UploadRequestError);
    expect(error).toMatchObject({ status: 404, transient: false, message: 'Not found.' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/uploads/S1/abort',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('treats a network failure as transient', async () => {
    const api = httpUploadApi((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(api.signParts('S1', [1])).rejects.toMatchObject({ status: 0, transient: true });
  });
});

describe('upload persistence', () => {
  it('fingerprints the same file for the same destination identically, and nothing else', () => {
    const file = { name: 'a.wav', size: 10, lastModified: 1 };
    expect(uploadFingerprint('A', file)).toBe(uploadFingerprint('A', { ...file }));
    expect(uploadFingerprint('A', file)).not.toBe(uploadFingerprint('B', file));
    expect(uploadFingerprint('A', file)).not.toBe(
      uploadFingerprint('A', { ...file, lastModified: 2 }),
    );
  });

  it('refuses to persist anything carrying a URL', async () => {
    const record = {
      fingerprint: 'f',
      sessionId: 'S',
      assetId: 'A',
      fileName: 'https://bucket.example/key?sig=x',
      sizeBytes: 1,
      lastModified: 1,
      partSizeBytes: 5 * MIB,
      checksumSha256: '0'.repeat(64),
      parts: [],
      expiresAt: new Date().toISOString(),
    };
    expect(() => assertNoCredentials(record)).toThrow(/URL/);
    await expect(memoryUploadStore().put(record)).rejects.toThrow(/URL/);
  });
});
