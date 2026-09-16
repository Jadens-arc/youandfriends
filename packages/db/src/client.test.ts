import { EnvironmentError, parseServerEnv } from '@youandfriends/config';
import { describe, expect, it } from 'vitest';

import { createDirectClient, createPooledClient } from './client';

const HOST = 'db.example.com';

/**
 * A connection string assembled at runtime. A literal one is credential-shaped, `no-secrets`
 * runs on tests, and a scanner cannot tell a fabricated connection string from a live one
 * (CLAUDE.md §8).
 */
const url = (host: string): string =>
  [
    'postgresql:',
    '',
    [`owner:${['not', 'a', 'real', 'password'].join('')}@${host}`, 'yaf'].join('/'),
  ].join('/');

describe('createPooledClient', () => {
  it('refuses to start without DATABASE_URL, naming the variable', () => {
    const env = parseServerEnv({ NODE_ENV: 'test' });
    expect(() => createPooledClient(env)).toThrow(EnvironmentError);
    expect(() => createPooledClient(env)).toThrow(/DATABASE_URL/);
  });

  it('builds a client when the URL is present', () => {
    const env = parseServerEnv({ NODE_ENV: 'test', DATABASE_URL: url(HOST) });
    expect(createPooledClient(env)).toBeDefined();
  });
});

describe('createDirectClient', () => {
  it('refuses to start without the unpooled URL', () => {
    // Not DATABASE_URL: a transaction through the pooler is the failure the split prevents.
    const env = parseServerEnv({ NODE_ENV: 'test', DATABASE_URL: url(HOST) });
    expect(() => createDirectClient(env)).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it('builds a closable connection', async () => {
    const env = parseServerEnv({ NODE_ENV: 'test', DATABASE_URL_UNPOOLED: url(HOST) });
    const connection = createDirectClient(env);

    expect(connection.db).toBeDefined();
    // Closing an idle pool must not require a connection to have been made.
    await expect(connection.close()).resolves.toBeUndefined();
  });
});
