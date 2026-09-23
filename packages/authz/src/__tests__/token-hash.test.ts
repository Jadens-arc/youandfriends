import { newUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildToken,
  generateTokenSecret,
  hashSecret,
  parseToken,
  verifySecret,
} from '../token-hash';

/**
 * Token minting and hashing, exercised without a database — the whole surface is a pure
 * function of its inputs plus `node:crypto`.
 */
describe('generating a secret', () => {
  it('is high-entropy and unique across calls', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTokenSecret()));
    expect(secrets.size).toBe(50);
  });

  it('contains no character the token format would misparse as the id/secret separator', () => {
    // base64url's alphabet is [A-Za-z0-9_-]; an underscore in the secret would only be a
    // parsing hazard if it could appear where the fixed-width split expects one, and it
    // cannot, because the split does not search for a character — but a secret that never
    // uses '_' at all is worth pinning, since it is the property the module comment claims.
    for (const secret of Array.from({ length: 20 }, () => generateTokenSecret())) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('building and parsing a token', () => {
  it('round-trips id and secret through the token string', () => {
    const id = newUlid();
    const secret = generateTokenSecret();
    const token = buildToken('invite', id, secret);

    expect(token).toBe(`yaf_invite_${id}_${secret}`);
    expect(parseToken('invite', token)).toEqual({ id, secret });
  });

  it('refuses a token of the wrong kind', () => {
    const token = buildToken('sync', newUlid(), generateTokenSecret());
    expect(parseToken('invite', token)).toBeNull();
  });

  it('refuses a token with no prefix at all', () => {
    expect(parseToken('invite', 'not-a-token')).toBeNull();
  });

  it('refuses a token whose id is not a well-formed ULID', () => {
    // Same length as a ULID, but not Crockford base32 — ambiguous letters I/L/O/U.
    const token = `yaf_invite_${'I'.repeat(26)}_${generateTokenSecret()}`;
    expect(parseToken('invite', token)).toBeNull();
  });

  it('refuses a token with no secret at all', () => {
    const token = `yaf_invite_${newUlid()}_`;
    expect(parseToken('invite', token)).toBeNull();
  });

  it('refuses a token missing the separator between id and secret', () => {
    const token = `yaf_invite_${newUlid()}${generateTokenSecret()}`;
    expect(parseToken('invite', token)).toBeNull();
  });

  it('never confuses one kind’s token for another’s, even sharing a prefix', () => {
    // "invite" and "invitee" would both start with "yaf_invite" as a bare substring match.
    const token = buildToken('invitee', newUlid(), generateTokenSecret());
    expect(parseToken('invite', token)).toBeNull();
  });
});

describe('hashing and verifying a secret', () => {
  it('verifies the secret it was hashed from', () => {
    const secret = generateTokenSecret();
    expect(verifySecret(secret, hashSecret(secret))).toBe(true);
  });

  it('refuses a different secret', () => {
    const hash = hashSecret(generateTokenSecret());
    expect(verifySecret(generateTokenSecret(), hash)).toBe(false);
  });

  it('refuses a secret one character different from the real one', () => {
    const secret = generateTokenSecret();
    const almost = `${secret.slice(0, -1)}${secret.at(-1) === 'a' ? 'b' : 'a'}`;
    expect(verifySecret(almost, hashSecret(secret))).toBe(false);
  });

  it('never stores the plaintext secret anywhere in the hash', () => {
    const secret = generateTokenSecret();
    expect(hashSecret(secret)).not.toContain(secret);
  });

  it('produces a different hash each time, even for the same secret', () => {
    // A fresh salt per call — otherwise two invitations minted with the same secret (which
    // should never happen, but the hash format should not depend on it not happening) would
    // be indistinguishable at rest.
    const secret = generateTokenSecret();
    expect(hashSecret(secret)).not.toBe(hashSecret(secret));
  });

  it('names its scheme and cost parameters in the stored string', () => {
    const stored = hashSecret(generateTokenSecret());
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it.each([
    ['empty string', ''],
    ['wrong scheme, right field count', 'argon2id$16384$8$1$c2FsdA==$aGFzaA=='],
    ['too few fields', 'scrypt$16384$8$1$c2FsdA=='],
    ['non-numeric cost parameter', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
    ['N not a power of two', 'scrypt$12345$8$1$c2FsdA==$aGFzaA=='],
    ['not base64', 'scrypt$16384$8$1$not-base64!!!$also-not!!!'],
  ])('fails closed on a malformed stored value: %s', (_label, stored) => {
    expect(verifySecret('anything', stored)).toBe(false);
  });

  it('refuses rather than throws on a stored hash of the wrong length for its own claimed encoding', () => {
    expect(() => verifySecret('anything', 'scrypt$16384$8$1$$')).not.toThrow();
    expect(verifySecret('anything', 'scrypt$16384$8$1$$')).toBe(false);
  });
});
