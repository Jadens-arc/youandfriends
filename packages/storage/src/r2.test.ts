import type { ServerEnv } from '@youandfriends/config';
import { describe, expect, it } from 'vitest';

import { DEFAULT_TTLS } from './driver';
import { contentDisposition, r2ConfigFrom, StorageNotConfiguredError } from './r2';

/**
 * Only the R2 fields, typed as the slice of `ServerEnv` the reader actually looks at.
 *
 * Not `as never`: that makes every spread below an error, and casting the problem away would
 * also stop the compiler noticing if a field were renamed.
 */
type R2Env = Pick<
  ServerEnv,
  | 'R2_ENDPOINT'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_BUCKET_ORIGINALS'
  | 'R2_BUCKET_DERIVATIVES'
>;

const asEnv = (env: R2Env): ServerEnv => env as ServerEnv;

const configured: R2Env = {
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  // Assembled from parts: `no-secrets` runs on test files, and a scanner cannot tell a
  // fabricated key from a live one (CLAUDE.md §8).
  R2_ACCESS_KEY_ID: ['AKIA', 'EXAMPLENOTREAL00'].join(''),
  R2_SECRET_ACCESS_KEY: ['wJalr', 'EXAMPLE', 'NOTAREALKEY'].join('/'),
  R2_BUCKET_ORIGINALS: 'youandfriends-originals',
  R2_BUCKET_DERIVATIVES: 'youandfriends-derivatives',
};

describe('reading the R2 configuration', () => {
  it('picks the bucket for the class asked for', () => {
    expect(r2ConfigFrom(asEnv(configured), 'originals').bucket).toBe('youandfriends-originals');
    expect(r2ConfigFrom(asEnv(configured), 'derivatives').bucket).toBe('youandfriends-derivatives');
  });

  it('names exactly what is missing rather than saying "not configured"', () => {
    // "Storage is not configured" sends someone to check five variables. Naming the absent one
    // is the difference between a minute and an afternoon.
    const partial = asEnv({ ...configured, R2_SECRET_ACCESS_KEY: undefined });
    expect(() => r2ConfigFrom(partial, 'originals')).toThrow(StorageNotConfiguredError);
    expect(() => r2ConfigFrom(partial, 'originals')).toThrow(/R2_SECRET_ACCESS_KEY/);
    // And does not name the ones that are present.
    expect(() => r2ConfigFrom(partial, 'originals')).not.toThrow(/R2_ENDPOINT/);
  });

  it('refuses when only the other bucket is set', () => {
    // A deploy that configured originals and forgot derivatives should fail on derivatives,
    // not silently write both classes into one bucket.
    const onlyOriginals = asEnv({ ...configured, R2_BUCKET_DERIVATIVES: undefined });
    expect(() => r2ConfigFrom(onlyOriginals, 'originals')).not.toThrow();
    expect(() => r2ConfigFrom(onlyOriginals, 'derivatives')).toThrow(/R2_BUCKET_DERIVATIVES/);
  });

  it('treats an empty string as absent', () => {
    // An unset variable in a deploy platform is commonly an empty string, not undefined.
    const empty = asEnv({ ...configured, R2_ENDPOINT: '' });
    expect(() => r2ConfigFrom(empty, 'originals')).toThrow(/R2_ENDPOINT/);
  });
});

describe('presign lifetimes', () => {
  it('keeps a download shorter than a stream', () => {
    // A download URL that reaches someone else's chat is a copy of the file. A stream URL has
    // to outlive a long track over a poor connection. They are not the same trade.
    expect(DEFAULT_TTLS.downloadSeconds).toBeLessThan(DEFAULT_TTLS.streamSeconds);
  });

  it('keeps every lifetime bounded and short', () => {
    // A bearer credential with no practical expiry is a permanent grant (THREAT_MODEL T3).
    for (const [name, seconds] of Object.entries(DEFAULT_TTLS)) {
      expect(seconds, name).toBeGreaterThan(0);
      expect(seconds, name).toBeLessThanOrEqual(60 * 60);
    }
  });
});

describe('the download filename', () => {
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  it('carries the name on the header, not in the key', () => {
    expect(contentDisposition('Blue Hour.wav')).toContain('attachment');
    expect(contentDisposition('Blue Hour.wav')).toContain('filename="Blue Hour.wav"');
  });

  it('cannot break out of the header value', () => {
    // A quote would end the value early; a newline would inject a second header entirely.
    expect(contentDisposition('evil".wav')).toContain(`${String.fromCharCode(92)}"`);

    const injected = contentDisposition(`a${CR}${LF}X-Injected: yes${CR}${LF}.wav`);

    // The property is that no line break survives, so the result is one header. The words
    // `X-Injected: yes` *do* remain, inside the quoted filename — and that is fine: with the
    // CRLF gone they are text in a filename, not a header. Asserting their absence would be
    // demanding more than the vulnerability requires, and would pass just as well against an
    // implementation that mangled ordinary names.
    expect(injected).not.toContain(LF);
    expect(injected).not.toContain(CR);
    expect(injected.split(';')[0]).toBe('attachment');
    // One line, therefore one header.
    expect(injected.split(/\r?\n/)).toHaveLength(1);
  });

  it('strips control characters rather than encoding them', () => {
    const value = contentDisposition(
      `tab${String.fromCharCode(9)}here${String.fromCharCode(0)}null.wav`,
    );
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f]/.test(value)).toBe(false);
  });

  it('keeps a UTF-8 name readable while giving ASCII a fallback', () => {
    const value = contentDisposition('Blue Hour — Café.wav');
    // The ASCII form must not contain the non-ASCII characters at all; the starred form carries
    // them percent-encoded for browsers that read it.
    expect(value).toMatch(/filename="[\u0020-\u007e]*"/);
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain(encodeURIComponent('—'));
  });

  it('bounds the length', () => {
    // A 4 KB filename in a header is a request some proxies reject outright.
    const value = contentDisposition('x'.repeat(4000));
    expect(value.length).toBeLessThan(1200);
  });
});
