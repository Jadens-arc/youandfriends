import { isUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { testId } from './factories';

describe('the test id generator', () => {
  it('produces ids the product would accept', () => {
    // It did not, for a long time: the first character was unbounded, and a ULID's leading
    // character encodes the high bits of a 48-bit timestamp and cannot exceed 7. Three quarters
    // of the ids were rejected by `ulidSchema`, which nothing noticed until a route validated
    // one — and then it failed intermittently.
    //
    // A factory producing values the product rejects means every test using it exercises a
    // shape production never sees, which is the whole point of `CLAUDE.md` §13's fixture rule.
    for (let index = 0; index < 500; index += 1) {
      const id = testId();
      expect(isUlid(id), id).toBe(true);
    }
  });

  it('still varies', () => {
    // A bound that collapsed the space would be a different bug.
    expect(new Set(Array.from({ length: 200 }, () => testId())).size).toBe(200);
    expect(new Set(Array.from({ length: 200 }, () => testId()[0])).size).toBeGreaterThan(1);
  });
});
