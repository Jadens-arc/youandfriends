import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EnvironmentError,
  hasSentryDsn,
  parsePublicEnv,
  parseServerEnv,
  requireServerEnv,
} from './env';

describe('server environment parsing', () => {
  it('applies documented defaults when optional variables are absent', () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.YOUANDFRIENDS_MAX_OBJECT_BYTES).toBe(2_147_483_648); // 2 GB
    expect(env.YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES).toBe(107_374_182_400); // 100 GB
    expect(env.YOUANDFRIENDS_DERIVATIVE_BITRATE).toBe('192k');
    expect(env.YOUANDFRIENDS_STREAM_URL_TTL_SECONDS).toBe(900);
  });

  it('coerces numeric variables from their string form', () => {
    const env = parseServerEnv({ YOUANDFRIENDS_MAX_OBJECT_BYTES: '1024' });
    expect(env.YOUANDFRIENDS_MAX_OBJECT_BYTES).toBe(1024);
  });

  it('reports EVERY problem at once, not just the first', () => {
    let caught: EnvironmentError | undefined;
    try {
      parseServerEnv({
        NODE_ENV: 'staging', // not a valid enum member
        R2_ENDPOINT: 'not-a-url',
        SENTRY_DSN: 'also-not-a-url',
        YOUANDFRIENDS_MAX_OBJECT_BYTES: '-5',
      });
    } catch (error) {
      caught = error as EnvironmentError;
    }

    expect(caught).toBeInstanceOf(EnvironmentError);
    expect(caught?.problems).toHaveLength(4);
    const report = caught?.problems.join('\n') ?? '';
    for (const key of ['NODE_ENV', 'R2_ENDPOINT', 'SENTRY_DSN', 'YOUANDFRIENDS_MAX_OBJECT_BYTES']) {
      expect(report).toContain(key);
    }
  });

  it('points the reader at .env.example', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'nonsense' })).toThrow(/\.env\.example/);
  });

  // A presigned URL TTL above an hour outlives what R2 will sign (ADR 0001).
  it('rejects a stream URL TTL beyond one hour', () => {
    expect(() => parseServerEnv({ YOUANDFRIENDS_STREAM_URL_TTL_SECONDS: '7200' })).toThrow(
      EnvironmentError,
    );
  });
});

describe('public environment', () => {
  it('returns only NEXT_PUBLIC_ variables, never a server secret', () => {
    const pub = parsePublicEnv({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_visible',
      CLERK_SECRET_KEY: 'sk_test_must_not_appear',
      DATABASE_URL: 'postgres://must/not/appear',
      R2_SECRET_ACCESS_KEY: 'must-not-appear',
    });

    expect(pub.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe('pk_test_visible');
    // The whole point: no secret survives the public parse, at runtime or in the type.
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('sk_test_must_not_appear');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('must-not-appear');
    expect(Object.keys(pub).every((key) => key.startsWith('NEXT_PUBLIC_'))).toBe(true);
  });
});

describe('requireServerEnv', () => {
  it('lists every missing variable at once', () => {
    const env = parseServerEnv({});
    let caught: EnvironmentError | undefined;
    try {
      requireServerEnv(env, ['DATABASE_URL', 'R2_ACCESS_KEY_ID', 'CLERK_SECRET_KEY']);
    } catch (error) {
      caught = error as EnvironmentError;
    }

    expect(caught).toBeInstanceOf(EnvironmentError);
    expect(caught?.problems).toHaveLength(3);
    expect(caught?.message).toContain('DATABASE_URL');
    expect(caught?.message).toContain('R2_ACCESS_KEY_ID');
    expect(caught?.message).toContain('CLERK_SECRET_KEY');
  });

  it('rejects an empty string at parse time, before requiredness is ever asked', () => {
    // `.min(1)` catches this earlier than requireServerEnv would, which is the behaviour we
    // want: a variable set to "" is a misconfiguration, not an absent optional.
    expect(() => parseServerEnv({ DATABASE_URL: '' })).toThrow(EnvironmentError);
  });

  it('treats an absent variable as missing', () => {
    const env = parseServerEnv({});
    expect(() => requireServerEnv(env, ['DATABASE_URL'])).toThrow(/DATABASE_URL/);
  });

  it('passes when every required variable is present', () => {
    const env = parseServerEnv({ DATABASE_URL: 'postgres://localhost/db' });
    expect(() => requireServerEnv(env, ['DATABASE_URL'])).not.toThrow();
  });
});

describe('hasSentryDsn', () => {
  it('is false when neither DSN is set', () => {
    expect(hasSentryDsn(parseServerEnv({}))).toBe(false);
  });

  it('is true when either DSN is set', () => {
    expect(hasSentryDsn(parseServerEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' }))).toBe(
      true,
    );
    expect(
      hasSentryDsn(parseServerEnv({ NEXT_PUBLIC_SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' })),
    ).toBe(true);
  });
});

describe('.env.example stays honest', () => {
  const envExample = readFileSync(
    fileURLToPath(new URL('../../../.env.example', import.meta.url)),
    'utf8',
  );
  const documented = new Set(
    envExample
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((name): name is string => Boolean(name)),
  );

  it('documents every variable the schema knows about', () => {
    const schemaKeys = Object.keys(parseServerEnv({}));
    const undocumented = schemaKeys.filter((key) => !documented.has(key));
    expect(undocumented).toEqual([]);
  });

  it('contains no credential values — only names and safe defaults', () => {
    const populated = envExample
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));

    for (const [, name, value] of populated) {
      // Only non-secret configuration may carry a default value. Anything else must be
      // present as a bare `NAME=` so a real credential cannot hide among the defaults.
      expect(name).toMatch(/^(YOUANDFRIENDS_|MINIO_ENDPOINT$|NODE_ENV$)/);
      expect(value).not.toMatch(/^(sk_|pk_live|rk_)/);
    }
  });
});
