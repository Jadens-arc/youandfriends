import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@youandfriends/storage', () => {
  it('resolves through the workspace graph', () => {
    expect(PACKAGE_NAME).toBe('@youandfriends/storage');
  });
});
