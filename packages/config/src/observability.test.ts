import { describe, expect, it, vi } from 'vitest';

import {
  createNoopReporter,
  createReporter,
  createSentryReporter,
  type SentryTransport,
} from './observability';
import { REDACTED } from './redact';

function fakeTransport(): SentryTransport & {
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
} {
  return { captureException: vi.fn(), captureMessage: vi.fn() };
}

describe('no-op reporter (no DSN configured)', () => {
  it('is silent — it does not write to the console', () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    const reporter = createNoopReporter();
    reporter.captureException(new Error('boom'));
    reporter.captureMessage('something');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('never throws', () => {
    const reporter = createNoopReporter();
    expect(() => reporter.captureException(new Error('boom'))).not.toThrow();
    expect(() => reporter.captureException(undefined)).not.toThrow();
    expect(() => reporter.captureMessage('x', { correlationId: 'c' })).not.toThrow();
  });
});

describe('createReporter selection', () => {
  it('selects the no-op when no DSN is configured', () => {
    const transport = fakeTransport();
    createReporter({ dsn: undefined, transport }).captureException(new Error('boom'));
    expect(transport.captureException).not.toHaveBeenCalled();
  });

  it('selects the no-op when a DSN is set but no transport is wired', () => {
    expect(() =>
      createReporter({ dsn: 'https://k@o.ingest.sentry.io/1' }).captureException(new Error('x')),
    ).not.toThrow();
  });

  it('reaches the transport when a DSN and transport are both present', () => {
    const transport = fakeTransport();
    const reporter = createReporter({ dsn: 'https://k@o.ingest.sentry.io/1', transport });
    reporter.captureException(new Error('boom'));
    expect(transport.captureException).toHaveBeenCalledOnce();
  });
});

describe('sentry reporter', () => {
  it('redacts context before it leaves the process', () => {
    const transport = fakeTransport();
    createSentryReporter(transport).captureException(new Error('boom'), {
      correlationId: 'c-1',
      CLERK_SECRET_KEY: 'sk_test_leak',
      url: 'https://b.r2.cloudflarestorage.com/o/1?X-Amz-Signature=deadbeef',
    });

    const [, hint] = transport.captureException.mock.calls[0]!;
    expect(hint.extra.correlationId).toBe('c-1');
    expect(hint.extra.CLERK_SECRET_KEY).toBe(REDACTED);
    expect(hint.extra.url).toBe(REDACTED);
  });

  it('swallows a transport failure — reporting must never break the request', () => {
    const transport: SentryTransport = {
      captureException: () => {
        throw new Error('sentry is down');
      },
      captureMessage: () => {
        throw new Error('sentry is down');
      },
    };
    const reporter = createSentryReporter(transport);
    expect(() => reporter.captureException(new Error('boom'))).not.toThrow();
    expect(() => reporter.captureMessage('hello')).not.toThrow();
  });
});
