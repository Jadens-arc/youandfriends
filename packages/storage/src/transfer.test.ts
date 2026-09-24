import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

import { newUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { newObjectKey } from './keys';
import { assertOverwritable, limitBytes, TransferLimitError } from './transfer';

describe('which keys a worker may overwrite', () => {
  const workspace = newUlid();

  it('allows a derivative key, which a retry must be able to replace', () => {
    expect(() => assertOverwritable(newObjectKey(workspace, 'derivative'))).not.toThrow();
  });

  it('refuses an original: uploaded bytes are never overwritten', () => {
    expect(() => assertOverwritable(newObjectKey(workspace, 'original'))).toThrow(/originals/);
  });

  it('refuses a key this product did not issue', () => {
    expect(() => assertOverwritable('../../etc/passwd')).toThrow(/not a key/);
    expect(() => assertOverwritable(`w/${workspace}/x/${newUlid()}`)).toThrow(/not a key/);
  });
});

describe('the download byte limit', () => {
  const sink = () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

  it('passes an object at the limit and counts it', async () => {
    const counter = limitBytes(8);
    await pipeline(Readable.from([Buffer.alloc(4), Buffer.alloc(4)]), counter, sink());
    expect(counter.count()).toBe(8);
  });

  it('fails the stream as soon as the limit is crossed, not after the whole body', async () => {
    const counter = limitBytes(8);
    await expect(
      pipeline(Readable.from([Buffer.alloc(8), Buffer.alloc(1)]), counter, sink()),
    ).rejects.toBeInstanceOf(TransferLimitError);
  });
});
