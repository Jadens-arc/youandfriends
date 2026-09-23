/**
 * Credential-shaped values for tests.
 *
 * Every value here is **assembled at runtime from parts**. No credential-shaped literal
 * appears in this file, so it would pass `no-secrets` even without the `fixtures/` exemption
 * — the exemption is a safety net, not the mechanism.
 *
 * The reason is not lint appeasement. A realistic literal in source:
 *   - trips provider secret scanners and GitHub push protection, blocking pushes;
 *   - cannot be distinguished by a scanner from a live key, so it costs a human triage;
 *   - and sits in local git history from the moment it is committed, even if the push fails.
 *
 * That happened during task `002`. This module is the fix.
 */

const join = (...parts: string[]): string => parts.join('');

/** A presigned R2/S3 URL. Redaction must catch this under any key name (THREAT_MODEL T3). */
export const presignedUrl = join(
  'https://bucket.r2.cloudflarestorage.com/w/ws_1/o/01J',
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256',
  `&X-Amz-Credential=${['abc', '20260915'].join('%2F')}`,
  `&X-Amz-${'Signature'}=${['dead', 'beef', 'cafe'].join('')}`,
);

/** A You & Friends sync token in the ADR 0005 format. */
export const syncToken = [
  'yaf',
  'sync',
  '01J8XKQ2M3N4P5R6S7T8V9W0XY',
  'aB3dE5gH7jK9mN1pQ3sT5vX7z',
].join('_');

/** A You & Friends invitation token in the task `032` format. */
export const inviteToken = [
  'yaf',
  'invite',
  '01J8XKQ2M3N4P5R6S7T8V9W0XZ',
  'nQ8vB2xR6tK4wL9pE1sD7fH3z',
].join('_');

/** A provider secret key shape, e.g. Stripe. */
export const providerSecretKey = ['sk', 'live', 'EXAMPLENOTAREALKEY000000'].join('_');

/** A bearer token carrying a JWT-shaped value. */
export const bearerToken = `Bearer ${[
  ['eyJ', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'].join(''),
  'abcdef',
].join('')}`;

/** A PEM private key header. */
export const privateKeyPem = `${['-----', 'BEGIN', ' RSA PRIVATE KEY', '-----'].join('')}\nMIIE...`;

/** A database connection string. */
export const databaseUrl = join('postgres://', 'user', ':', 'pw', '@host/db');

/** An ordinary URL, for asserting that redaction does NOT over-reach. */
export const plainUrl = 'https://youandfriends.org/songs/01J8XK';

/**
 * A Svix webhook signing secret, the shape Clerk issues (`whsec_` + base64 key). The key is a
 * phrase, not random bytes, so nothing about it resembles a real secret except its framing.
 */
export const webhookSigningSecret = [
  'whsec',
  Buffer.from(['not', 'a', 'real', 'signing', 'key'].join('-')).toString('base64'),
].join('_');
