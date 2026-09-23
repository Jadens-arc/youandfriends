import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { isUlid } from '@youandfriends/contracts';

/**
 * High-entropy bearer tokens: minting, and hashing them for storage.
 *
 * **Shape:** `yaf_<kind>_<26-char ULID>_<secret>`, the format ADR 0005 chose for sync tokens
 * (task `110`) and this reuses for invitation tokens (task `032`). The ULID is the lookup key
 * — public, indexed, the row's own id — and only the secret half is sensitive. The `yaf_`
 * prefix is what makes a leaked token findable by a secret scanner and by this repo's own
 * redaction list (`packages/config/src/redact.ts`).
 *
 * **Hashed with `scrypt`, not Argon2id.** ADR 0005 names Argon2id for sync tokens, and the
 * instinct to match it here is reasonable — but Argon2id's cost is bought for a *low-entropy*
 * secret, where a slow, memory-hard function is what stands between a stolen hash and a
 * successful offline guess. The secret half of a token minted here is 256 bits of
 * {@link randomBytes}: guessing it is infeasible regardless of how fast the hash function is,
 * so the property Argon2id buys is not one this token needs. What it does need — the token is
 * never stored in reversible form, and comparison does not leak timing — `scrypt` gives, as a
 * dependency-free part of Node itself. The alternative was a native Argon2id addon, verified to
 * build in this sandbox but not in Vercel's own build image, freshly bitten this session by a
 * bundling defect in a package this one is a dependency of; a security primitive is not where
 * that risk belongs. See ADR 0010.
 */

const TOKEN_PREFIX = 'yaf';
const ULID_LENGTH = 26;
/** 32 random bytes, base64url-encoded without padding: 43 characters, 256 bits of entropy. */
const SECRET_BYTES = 32;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DERIVED_KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** A fresh, high-entropy secret. Never logged, never stored — only its hash is. */
export function generateTokenSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** Assemble the token handed to the invitee. `id` is the row's own id — see the module comment. */
export function buildToken(kind: string, id: string, secret: string): string {
  return `${TOKEN_PREFIX}_${kind}_${id}_${secret}`;
}

export interface ParsedToken {
  readonly id: string;
  readonly secret: string;
}

/**
 * Split a presented token into its lookup key and its secret, or `null` if it is not even the
 * right shape.
 *
 * The id is fixed-width, so the split is exact rather than "the last underscore" — a secret
 * happens to be generated without underscores today (`base64url`'s alphabet has none), but a
 * parser that depended on that would be one alphabet change away from silently misparsing.
 */
export function parseToken(kind: string, token: string): ParsedToken | null {
  // Checked explicitly even though a wrong prefix's misaligned slice almost always fails the
  // `isUlid` check below anyway (Crockford's leading-character restriction alone rejects most
  // garbage): "almost always" is not a boundary this function gets to rely on, so the kind is
  // verified on its own terms rather than as a side effect of the id happening to look wrong.
  const prefix = `${TOKEN_PREFIX}_${kind}_`;
  if (!token.startsWith(prefix)) return null;

  const rest = token.slice(prefix.length);
  const id = rest.slice(0, ULID_LENGTH);
  const separator = rest.slice(ULID_LENGTH, ULID_LENGTH + 1);
  const secret = rest.slice(ULID_LENGTH + 1);

  if (!isUlid(id) || separator !== '_' || secret.length === 0) return null;
  return { id, secret };
}

/**
 * Hash a secret for storage, as a self-describing string carrying its own parameters and salt
 * (`scrypt$N$r$p$salt$hash`, base64 for the binary parts). Self-describing so the cost
 * parameters can be strengthened later without a migration that has to know what every
 * existing row used.
 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, DERIVED_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Check a presented secret against a stored hash, in constant time.
 *
 * Reads the parameters and salt back out of the stored string rather than assuming today's
 * constants — a hash written under yesterday's cost settings still verifies correctly. A
 * malformed stored value (never one this module wrote) fails closed rather than throwing, since
 * a throw here would have to be caught by every caller to stay fail-closed, and one that forgot
 * would fail open instead.
 */
export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  if (scheme !== 'scrypt') return false;

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? '', 'base64');
    expected = Buffer.from(hashB64 ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(secret, salt, expected.length, { N, r, p });
  } catch {
    // Cost parameters `scrypt` itself refuses (e.g. N not a power of two) — not this
    // module's own output, so not a secret worth verifying against.
    return false;
  }

  // `timingSafeEqual` requires equal-length buffers; a length mismatch is already "no match"
  // and is decided before the call so it never throws.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
