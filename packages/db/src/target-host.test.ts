import { describe, expect, it } from 'vitest';

import { describeTarget, targetHost } from './target-host';

/**
 * The host every writing CLI announces before it writes (`docs/THREAT_MODEL.md` T10), and the
 * value the seed guard refuses on. Both uses depend on it never quietly returning something
 * plausible for a string it could not parse.
 */
describe('reading a database target', () => {
  it('reads the host out of a Postgres URL', () => {
    // `postgresql://` is not a special scheme to WHATWG URL, so this is the case worth pinning.
    expect(targetHost(['postgresql', '://u:p@db.example.com:5432/app'].join(''))).toBe(
      'db.example.com',
    );
    expect(targetHost(['postgres', '://localhost:5433/yaf'].join(''))).toBe('localhost');
  });

  it('lowercases, so a host cannot be smuggled past a comparison by case', () => {
    expect(targetHost(['postgres', '://u:p@PROD.Example.COM/db'].join(''))).toBe(
      'prod.example.com',
    );
  });

  it('returns null rather than a guess when the string is not a URL at all', () => {
    for (const value of ['', 'not a url', '/var/run/postgresql']) {
      expect(targetHost(value), value).toBeNull();
    }
  });

  it('reports an empty host for a unix socket, which is what it is', () => {
    // `postgresql:///db?host=/var/run/postgresql` is the socket form and has no hostname. The
    // seed guard counts empty as local, and that is right rather than an oversight: a unix
    // socket is necessarily the same machine. The malformed `postgres://` lands here too and
    // connects to nothing, so treating it as local costs nothing.
    expect(targetHost(['postgresql', ':///db?host=/var/run/postgresql'].join(''))).toBe('');
    expect(targetHost(['postgres', '://'].join(''))).toBe('');
  });

  it('says so out loud when it cannot tell', () => {
    // An operator reading `Target: ` with nothing after it learns nothing. The whole point of
    // the line is to be readable at a glance in the wrong shell.
    expect(describeTarget(undefined)).toContain('no database URL is set');
    expect(describeTarget('')).toContain('no database URL is set');
    expect(describeTarget('not a url')).toContain('no readable host');
    expect(describeTarget(['postgres', '://localhost/x'].join(''))).toBe('localhost');
  });
});
