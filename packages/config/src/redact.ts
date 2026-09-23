/**
 * Redaction for structured logs, error reports, and audit metadata.
 *
 * This is a security control, not a convenience (docs/THREAT_MODEL.md T3, T9). Presigned
 * URLs are bearer credentials for their TTL, so a URL in a log is a leak with a stopwatch on
 * it. A careless `log.info({ session })` must not be able to spill a credential.
 *
 * The deny-list is applied at serialization time so it catches values the caller never meant
 * to log. It errs toward over-redaction: a redacted field that was harmless costs a debugging
 * round-trip, while a leaked one costs a rotation.
 */

export const REDACTED = '[redacted]' as const;

/** Key names whose values are never logged, matched case-insensitively as substrings. */
const DENIED_KEY_PATTERNS: readonly RegExp[] = [
  /secret/i,
  /token/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /authorization/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /api[-_]?key/i,
  /access[-_]?key/i,
  /private[-_]?key/i,
  /database_url/i,
  /connection[-_]?string/i,
  /signature/i,
  /verifier/i,
];

/**
 * Value shapes that are credentials wherever they appear, whatever the key is called.
 * A presigned URL logged as `{ url: ... }` is just as dangerous as one logged as
 * `{ signedUrl: ... }`.
 */
const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  /[?&]X-Amz-Signature=/i, // S3/R2 presigned URL
  /[?&]X-Amz-Credential=/i,
  /[?&]Signature=/i, // generic presigned shapes
  /\byaf_sync_[A-Za-z0-9_]+/, // You & Friends sync token (ADR 0005)
  /\byaf_invite_[A-Za-z0-9_]+/, // You & Friends invitation token (task `032`)
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/, // provider secret keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  // A connection string carrying credentials, under any scheme. `DATABASE_URL` is already
  // denied by key, but `pg` puts the whole URL inside connection-error messages, where no
  // key name protects it — which is how the credential actually escapes (task `020`).
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/i,
];

/** True when a key's value must never be logged. */
export function isDeniedKey(key: string): boolean {
  // A NEXT_PUBLIC_ variable is public by construction — redacting it hides nothing and
  // makes logs harder to read.
  if (key.startsWith('NEXT_PUBLIC_')) return false;
  return DENIED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** True when a string is credential-shaped regardless of the key it arrived under. */
export function isDeniedValue(value: string): boolean {
  return DENIED_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

const MAX_DEPTH = 8;

/**
 * Deep-redact a value for logging.
 *
 * Returns a new structure; the input is never mutated. Cycles are broken, and depth is capped
 * so a pathological object cannot hang the logger.
 */
export function redact(input: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return '[max depth]';

  if (typeof input === 'string') {
    return isDeniedValue(input) ? REDACTED : input;
  }

  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (seen.has(input)) return '[circular]';
  seen.add(input);

  if (input instanceof Error) {
    return {
      name: input.name,
      message: isDeniedValue(input.message) ? REDACTED : input.message,
      stack: input.stack,
    };
  }

  if (Array.isArray(input)) {
    return input.map((item) => redact(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = isDeniedKey(key) ? REDACTED : redact(value, depth + 1, seen);
  }
  return output;
}
