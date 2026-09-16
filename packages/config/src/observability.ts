/**
 * Error reporting.
 *
 * An interface with two implementations, selected by whether a Sentry DSN is configured.
 * With no DSN the reporter is a genuine no-op: silent, and it never throws. A reporter that
 * console-spews when unconfigured trains people to ignore it; one that throws takes down the
 * request it was meant to report on.
 *
 * The Sentry SDK is deliberately not a dependency of this package. `createSentryReporter`
 * takes the transport as an argument so `packages/config` stays free of a vendor SDK and the
 * adapter is trivially testable.
 */

import { redact } from './redact';

export interface ErrorContext {
  correlationId?: string;
  [key: string]: unknown;
}

export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): void;
  captureMessage(message: string, context?: ErrorContext): void;
}

/** Used when no DSN is configured. Silent, and it never throws. */
export function createNoopReporter(): ErrorReporter {
  return {
    captureException: () => {},
    captureMessage: () => {},
  };
}

export interface SentryTransport {
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): void;
  captureMessage(message: string, hint?: { extra?: Record<string, unknown> }): void;
}

/**
 * Wrap a Sentry-compatible transport.
 *
 * Context is redacted before it leaves the process, and transport failures are swallowed:
 * error reporting must never be the thing that breaks a request.
 */
export function createSentryReporter(transport: SentryTransport): ErrorReporter {
  return {
    captureException(error, context) {
      try {
        transport.captureException(redact(error), {
          extra: redact(context ?? {}) as Record<string, unknown>,
        });
      } catch {
        // Reporting the reporter's failure has nowhere to go. Drop it.
      }
    },
    captureMessage(message, context) {
      try {
        transport.captureMessage(message, {
          extra: redact(context ?? {}) as Record<string, unknown>,
        });
      } catch {
        /* see above */
      }
    },
  };
}

/** Select a reporter: the transport when a DSN is configured, the no-op otherwise. */
export function createReporter(options: {
  dsn?: string | undefined;
  transport?: SentryTransport | undefined;
}): ErrorReporter {
  if (!options.dsn || !options.transport) return createNoopReporter();
  return createSentryReporter(options.transport);
}
