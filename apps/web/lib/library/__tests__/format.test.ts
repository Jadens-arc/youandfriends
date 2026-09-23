import { describe, expect, it } from 'vitest';

import { formatRelative, formatSongCount, initialsOf, stableIndex } from '../format';

describe('formatRelative', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('reads naturally from seconds to days', () => {
    expect(formatRelative(ago(10_000), now)).toBe('just now');
    // A clock slightly ahead is still "just now".
    expect(formatRelative(ago(-5_000), now)).toBe('just now');
    expect(formatRelative(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe('3 hours ago');
    expect(formatRelative(ago(26 * 3_600_000), now)).toBe('yesterday');
    expect(formatRelative(ago(4 * 86_400_000), now)).toBe('4 days ago');
  });

  it('switches to a date after a week, adding the year only when it differs', () => {
    expect(formatRelative(new Date('2026-03-04T12:00:00Z'), now)).toBe('Mar 4');
    expect(formatRelative(new Date('2025-03-04T12:00:00Z'), now)).toBe('Mar 4, 2025');
  });
});

describe('formatSongCount', () => {
  it('pluralizes', () => {
    expect(formatSongCount(0)).toBe('0 songs');
    expect(formatSongCount(1)).toBe('1 song');
    expect(formatSongCount(12)).toBe('12 songs');
  });
});

describe('initialsOf', () => {
  it('takes up to two initials from words with letters or digits', () => {
    expect(initialsOf('night drives')).toBe('ND');
    expect(initialsOf('The Long Way Home')).toBe('TL');
    expect(initialsOf('  "quoted" name ')).toBe('QN');
    expect(initialsOf('808s')).toBe('8');
    expect(initialsOf('— —')).toBe('·');
  });
});

describe('stableIndex', () => {
  it('is stable and in range', () => {
    expect(stableIndex('P1', 3)).toBe(stableIndex('P1', 3));
    for (const id of ['a', 'bb', 'PROJECT0001', 'Z'.repeat(40)]) {
      const index = stableIndex(id, 3);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });
});
