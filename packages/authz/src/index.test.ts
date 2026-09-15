import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@youandfriends/authz', () => {
  it('resolves through the workspace graph', () => {
    expect(PACKAGE_NAME).toBe('@youandfriends/authz');
  });
});
