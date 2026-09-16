import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDatabaseEnv } from './env-file';

const value = (host: string): string =>
  ['postgresql:', '', [`owner:${['not', 'real'].join('')}@${host}`, 'yaf'].join('/')].join('/');

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yaf-env-'));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

describe('loadDatabaseEnv', () => {
  it('reads the database URLs from .env.local', () => {
    const env: Record<string, string | undefined> = {};
    loadDatabaseEnv(
      root({ '.env.local': `DATABASE_URL=${value('a')}\nDATABASE_URL_UNPOOLED=${value('b')}\n` }),
      env,
    );

    expect(env.DATABASE_URL).toBe(value('a'));
    expect(env.DATABASE_URL_UNPOOLED).toBe(value('b'));
  });

  it('lets an ambient value win, because CI sets the real one', () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: value('ambient') };
    loadDatabaseEnv(root({ '.env.local': `DATABASE_URL=${value('file')}\n` }), env);

    expect(env.DATABASE_URL).toBe(value('ambient'));
  });

  it('prefers .env.test.local, so tests cannot be aimed at a development database', () => {
    const env: Record<string, string | undefined> = {};
    loadDatabaseEnv(
      root({
        '.env.test.local': `DATABASE_URL=${value('test')}\n`,
        '.env.local': `DATABASE_URL=${value('dev')}\n`,
      }),
      env,
    );

    expect(env.DATABASE_URL).toBe(value('test'));
  });

  it('reads nothing but the two database keys', () => {
    const env: Record<string, string | undefined> = {};
    const other = `${['CLERK', 'SECRET', 'KEY'].join('_')}=ignored`;
    loadDatabaseEnv(root({ '.env.local': `${other}\nNODE_ENV=production\n` }), env);

    // A loader that imported the whole file could silently switch NODE_ENV under a test run.
    expect(env).toEqual({});
  });

  it('strips quotes and surrounding space', () => {
    const env: Record<string, string | undefined> = {};
    loadDatabaseEnv(root({ '.env.local': `  DATABASE_URL = "${value('q')}"  \n` }), env);

    expect(env.DATABASE_URL).toBe(value('q'));
  });

  it('ignores an empty assignment rather than setting an empty string', () => {
    // An empty value would satisfy a presence check and then fail at connection time.
    const env: Record<string, string | undefined> = {};
    loadDatabaseEnv(root({ '.env.local': 'DATABASE_URL=\n' }), env);

    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('does nothing when no file exists', () => {
    const env: Record<string, string | undefined> = {};
    expect(() => loadDatabaseEnv(root({}), env)).not.toThrow();
    expect(env).toEqual({});
  });
});
