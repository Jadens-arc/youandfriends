import { describe, expect, it } from 'vitest';

import {
  ENV_PREFIX,
  PRODUCT_ATTRIBUTION,
  PRODUCT_DOMAIN,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from './index';

describe('product identity', () => {
  it('always renders the name with an ampersand', () => {
    expect(PRODUCT_NAME).toBe('You & Friends');
    expect(PRODUCT_NAME).toContain('&');
    expect(PRODUCT_NAME).not.toMatch(/\band\b/);
  });

  it('carries the agreed attribution, tagline, and domain', () => {
    expect(PRODUCT_ATTRIBUTION).toBe('by Avery and Friends');
    expect(PRODUCT_TAGLINE).toBe('Where songs live between sessions.');
    expect(PRODUCT_DOMAIN).toBe('youandfriends.org');
  });

  it('uses the youandfriends slug for the environment prefix', () => {
    expect(ENV_PREFIX).toBe('YOUANDFRIENDS_');
  });
});
