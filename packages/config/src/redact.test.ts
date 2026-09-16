import { describe, expect, it } from 'vitest';

import { isDeniedKey, isDeniedValue, redact, REDACTED } from './redact';

describe('redaction — denied keys', () => {
  it.each([
    'CLERK_SECRET_KEY',
    'R2_SECRET_ACCESS_KEY',
    'TRIGGER_SECRET_KEY',
    'DATABASE_URL',
    'authorization',
    'Authorization',
    'cookie',
    'apiKey',
    'api_key',
    'accessKey',
    'privateKey',
    'password',
    'passwordVerifier',
    'syncToken',
    'connectionString',
  ])('redacts %s', (key) => {
    expect(isDeniedKey(key)).toBe(true);
    expect(redact({ [key]: 'sensitive' })).toEqual({ [key]: REDACTED });
  });

  it('does not redact NEXT_PUBLIC_ variables, which are public by construction', () => {
    expect(isDeniedKey('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')).toBe(false);
    expect(redact({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_visible' })).toEqual({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_visible',
    });
  });

  it('leaves ordinary fields alone', () => {
    expect(redact({ songId: 'abc', durationMs: 1000 })).toEqual({
      songId: 'abc',
      durationMs: 1000,
    });
  });
});

describe('redaction — credential-shaped values', () => {
  // Credential-shaped fixtures are assembled at runtime rather than written as literals.
  // A realistic literal trips GitHub push protection and provider secret scanners, and a
  // scanner cannot tell a fabricated key from a live one — nor should it have to.
  const fakeProviderKey = ['sk', 'live', `EXAMPLE${'0'.repeat(8)}NOTAREALKEY`].join('_');

  // A presigned URL is a bearer credential for its TTL (THREAT_MODEL T3). It must be
  // redacted wherever it appears, whatever the key is called.
  const presigned =
    'https://bucket.r2.cloudflarestorage.com/w/ws_1/o/01J?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    '&X-Amz-Credential=abc%2F20260915&X-Amz-Signature=deadbeefcafe';

  it('redacts a presigned URL under an innocuous key', () => {
    expect(redact({ url: presigned })).toEqual({ url: REDACTED });
    expect(isDeniedValue(presigned)).toBe(true);
  });

  it.each([
    ['sync token', 'yaf_sync_01J8XKQ2M3N4P5R6S7T8V9W0XY_aB3dE5gH7jK9mN1pQ3sT5vX7z'],
    ['provider secret key', fakeProviderKey],
    ['bearer header', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...'],
  ])('redacts a %s under an innocuous key', (_label, value) => {
    expect(redact({ note: value })).toEqual({ note: REDACTED });
  });

  it('redacts a bare credential string, not only object fields', () => {
    expect(redact(presigned)).toBe(REDACTED);
  });

  it('leaves an ordinary URL readable', () => {
    const plain = 'https://youandfriends.org/songs/01J8XK';
    expect(redact({ url: plain })).toEqual({ url: plain });
  });
});

describe('redaction — structure handling', () => {
  it('recurses into nested objects and arrays', () => {
    const input = { a: { b: [{ CLERK_SECRET_KEY: 'x' }, { ok: 1 }] } };
    expect(redact(input)).toEqual({ a: { b: [{ CLERK_SECRET_KEY: REDACTED }, { ok: 1 }] } });
  });

  it('does not mutate its input', () => {
    const input = { DATABASE_URL: 'postgres://user:pw@host/db' };
    redact(input);
    expect(input.DATABASE_URL).toBe('postgres://user:pw@host/db');
  });

  it('breaks cycles rather than hanging', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ name: 'loop', self: '[circular]' });
  });

  it('caps depth rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[max depth]');
  });

  it('redacts a credential inside an Error message', () => {
    const err = new Error(`upload failed for ${['sk', 'live', 'EXAMPLENOTAREAL'].join('_')}`);
    expect(redact(err)).toMatchObject({ name: 'Error', message: REDACTED });
  });
});
