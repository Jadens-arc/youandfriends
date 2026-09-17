import { describe, expect, it } from 'vitest';

import * as storage from './index';

describe('the package surface', () => {
  it('exports the driver contract and the key helpers', () => {
    expect(storage.PACKAGE_NAME).toBe('@youandfriends/storage');
    for (const name of ['createR2Driver', 'newObjectKey', 'assertBucketPrivate', 'DEFAULT_TTLS']) {
      expect(storage, name).toHaveProperty(name);
    }
  });

  it('exports no S3 client of its own', () => {
    // The driver is the boundary. Re-exporting the SDK would let a caller reach past it and
    // sign whatever it liked, with none of the key or TTL policy applied.
    expect(storage).not.toHaveProperty('S3Client');
    expect(storage).not.toHaveProperty('getSignedUrl');
  });
});
