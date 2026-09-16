import { describe, expect, it } from 'vitest';

import { databaseOf, scratchName, withDatabase } from './scratch';

const EXAMPLE = 'postgresql://owner:secret@db.example.com/youandfriends?sslmode=require';

describe('scratchName', () => {
  it('produces a name Postgres accepts unquoted', () => {
    expect(scratchName('withTransaction.test.ts')).toMatch(/^yaf_scratch_[a-z0-9_]+_[0-9a-f]{8}$/);
  });

  it('is unique per call, so two test files never share a database', () => {
    const names = new Set(Array.from({ length: 50 }, () => scratchName('same')));
    expect(names.size).toBe(50);
  });

  it('survives a label that is entirely punctuation', () => {
    expect(scratchName('---')).toMatch(/^yaf_scratch__[0-9a-f]{8}$/);
  });

  it('truncates a long label rather than exceeding the identifier limit', () => {
    // Postgres truncates identifiers at 63 bytes, silently. Two long labels truncated to the
    // same prefix would collide, and the random suffix must survive.
    const name = scratchName('a'.repeat(200));
    expect(name.length).toBeLessThan(63);
    expect(name).toMatch(/_[0-9a-f]{8}$/);
  });
});

describe('withDatabase', () => {
  it('swaps the database and keeps every parameter', () => {
    const swapped = withDatabase(EXAMPLE, 'scratch_1');
    expect(databaseOf(swapped)).toBe('scratch_1');
    expect(swapped).toContain('sslmode=require');
  });

  it('keeps the credentials, since the scratch database is on the same server', () => {
    expect(withDatabase(EXAMPLE, 'scratch_1')).toContain('owner:secret@db.example.com');
  });
});
