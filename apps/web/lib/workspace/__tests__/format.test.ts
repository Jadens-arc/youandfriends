import { describe, expect, it } from 'vitest';

import { formatBytes, percentOf } from '../format';

describe('showing byte counts', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1023 bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 ** 2, '5 MB'],
    [12.4 * 1024 ** 3, '12 GB'],
    [9.94 * 1024 ** 3, '9.9 GB'],
    // The default quota, which is exactly 100 × 1024³. Shown in decimal it would read 107.4 GB.
    [107_374_182_400, '100 GB'],
    [3 * 1024 ** 4, '3 TB'],
    [5000 * 1024 ** 4, '5000 TB'],
  ])('%d → %s', (bytes, shown) => {
    expect(formatBytes(bytes)).toBe(shown);
  });

  it('refuses to invent a figure for a value that is not one', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(value)).toBe('—');
    }
  });
});

describe('share of the quota', () => {
  it('rounds to whole percent', () => {
    expect(percentOf(1, 3)).toBe(33);
  });

  it('clamps above the quota, so an over-quota workspace does not overflow its meter', () => {
    expect(percentOf(150, 100)).toBe(100);
  });

  it('treats a zero quota as full rather than dividing by it', () => {
    expect(percentOf(0, 0)).toBe(100);
  });
});
