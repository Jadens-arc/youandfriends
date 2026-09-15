import { describe, expect, it } from 'vitest';

import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';

/**
 * Component rendering tests arrive with Testing Library in task `001`.
 * This asserts the brand invariants the landing surface depends on, so a regression in the
 * product name is caught from the first commit.
 */
describe('landing surface', () => {
  it('renders the product name with the ampersand', () => {
    expect(PRODUCT_NAME).toBe('You & Friends');
  });

  it('carries the agreed tagline', () => {
    expect(PRODUCT_TAGLINE).toBe('Where songs live between sessions.');
  });
});
