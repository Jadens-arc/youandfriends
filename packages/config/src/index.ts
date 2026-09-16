/**
 * `@youandfriends/config`
 *
 * Environment parsing, structured logging, redaction, and observability hooks.
 * See docs/ARCHITECTURE.md §9.
 */

/** Product identity. The ampersand is part of the name — see `docs/DESIGN.md` §16. */
export const PRODUCT_NAME = 'You & Friends' as const;
export const PRODUCT_ATTRIBUTION = 'by Avery and Friends' as const;
export const PRODUCT_TAGLINE = 'Where songs live between sessions.' as const;
export const PRODUCT_DOMAIN = 'youandfriends.org' as const;

/**
 * Prefix for product-specific environment variables. Provider SDKs keep their own
 * conventional names (`CLERK_SECRET_KEY`, `DATABASE_URL`, …).
 */
export const ENV_PREFIX = 'YOUANDFRIENDS_' as const;

export {
  EnvironmentError,
  hasSentryDsn,
  parsePublicEnv,
  parseServerEnv,
  requireServerEnv,
  type PublicEnv,
  type ServerEnv,
} from './env';
export { isDeniedKey, isDeniedValue, redact, REDACTED } from './redact';
export {
  createLogger,
  loggerForEnv,
  newCorrelationId,
  type Logger,
  type LogLevel,
  type LogRecord,
} from './logger';
export {
  createNoopReporter,
  createReporter,
  createSentryReporter,
  type ErrorContext,
  type ErrorReporter,
  type SentryTransport,
} from './observability';
