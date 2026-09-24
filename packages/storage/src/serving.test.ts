import { newUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { newObjectKey } from './keys';
import { createR2Driver, readOverrides } from './r2';

/**
 * What a presigned read tells the browser the bytes are (task `067`). Signing is local
 * arithmetic, so these run without a server: the overrides are in the URL's query, and S3 (and
 * R2) put them on the response verbatim. The MinIO contract suite repeats the HTML case against
 * a real server.
 */
const driver = createR2Driver({
  endpoint: 'https://account.r2.example',
  // Assembled rather than written: credential-shaped literals trip the scanners (CLAUDE.md §8).
  accessKeyId: ['test', 'access', 'id'].join('-'),
  secretAccessKey: ['not', 'a', 'real', 'secret'].join('-'),
  bucket: 'youandfriends-test',
});

function served(url: string) {
  const query = new URL(url).searchParams;
  return {
    type: query.get('response-content-type'),
    disposition: query.get('response-content-disposition'),
  };
}

const workspace = newUlid();
const derivative = newObjectKey(workspace, 'derivative');
const original = newObjectKey(workspace, 'original');

describe('serving stored objects', () => {
  it('streams an audio derivative inline, as the type recorded for it', async () => {
    expect(
      served((await driver.signStream({ key: derivative, contentType: 'audio/mp4' })).url),
    ).toEqual({
      type: 'audio/mp4',
      disposition: 'inline',
    });
  });

  it('never serves an original inline, even when asked to stream it', async () => {
    const { disposition, type } = served(
      (await driver.signStream({ key: original, contentType: 'audio/wav' })).url,
    );
    expect(disposition).toBe('attachment');
    expect(type).toBe('audio/wav');
  });

  it('downloads as an attachment with the filename, whatever the type', async () => {
    const { disposition, type } = served(
      (
        await driver.signDownload({
          key: original,
          contentType: 'audio/flac',
          filename: 'Mix 3.flac',
        })
      ).url,
    );
    expect(disposition).toMatch(/^attachment; filename="Mix 3.flac"/);
    expect(type).toBe('audio/flac');
  });

  it('serves an HTML-bodied object as an opaque attachment, whatever the column says', async () => {
    for (const contentType of ['text/html', 'image/svg+xml', 'text/html; charset=utf-8', null]) {
      for (const signed of [
        await driver.signStream({ key: derivative, contentType }),
        await driver.signDownload({ key: derivative, contentType, filename: 'x.html' }),
      ]) {
        const { type, disposition } = served(signed.url);
        expect(type).toBe('application/octet-stream');
        expect(disposition).toMatch(/^attachment/);
      }
    }
  });

  it('treats a key it did not issue like an original: never inline', () => {
    expect(readOverrides('somewhere/else', 'audio/mp4', 'inline', undefined)).toEqual({
      ResponseContentType: 'audio/mp4',
      ResponseContentDisposition: 'attachment',
    });
  });
});
