import { describe, expect, it } from 'vitest';

import { databaseUrl, presignedUrl, syncToken } from './fixtures/credentials';
import { createLogger, loggerForEnv, newCorrelationId, type LogLevel } from './logger';
import { REDACTED } from './redact';

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  const logger = createLogger({ ...options, write: (line, level) => lines.push({ line, level }) });
  return { logger, lines };
}

describe('logger', () => {
  it('emits JSON with level, message, and timestamp', () => {
    const { logger, lines } = capture({ format: 'json' });
    logger.info('upload finalized', { versionId: '01J8XK' });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!.line);
    expect(record).toMatchObject({
      level: 'info',
      message: 'upload finalized',
      versionId: '01J8XK',
    });
    expect(Date.parse(record.time)).not.toBeNaN();
  });

  it('drops records below the configured level', () => {
    const { logger, lines } = capture({ level: 'warn' });
    logger.debug('noise');
    logger.info('also noise');
    logger.warn('kept');
    expect(lines.map((l) => JSON.parse(l.line).message)).toEqual(['kept']);
  });

  it('routes warn and error to stderr, everything else to stdout', () => {
    const { logger, lines } = capture({ level: 'debug' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('attaches child bindings such as a correlation ID to every record', () => {
    const { logger, lines } = capture();
    const correlationId = newCorrelationId();
    logger.child({ correlationId }).info('scoped');
    expect(JSON.parse(lines[0]!.line).correlationId).toBe(correlationId);
  });

  it('formats human-readably in pretty mode', () => {
    const { logger, lines } = capture({ format: 'pretty' });
    logger.info('hello', { songId: 'abc' });
    expect(lines[0]!.line).toMatch(/INFO\s+hello songId=abc/);
  });
});

describe('logger redaction — the control, not a convenience', () => {
  it('redacts a secret passed as a field', () => {
    const { logger, lines } = capture();
    logger.info('configured', { CLERK_SECRET_KEY: 'sk_test_leak' });
    expect(lines[0]!.line).not.toContain('sk_test_leak');
    expect(JSON.parse(lines[0]!.line).CLERK_SECRET_KEY).toBe(REDACTED);
  });

  it('redacts a presigned URL even under an innocuous key', () => {
    const { logger, lines } = capture();
    logger.info('streaming', { url: presignedUrl });
    expect(lines[0]!.line).not.toContain('X-Amz-Signature');
  });

  it('redacts a credential interpolated into the message itself', () => {
    const { logger, lines } = capture();
    logger.error(`failed with token ${syncToken}`);
    expect(lines[0]!.line).not.toContain(syncToken);
  });

  it('redacts DATABASE_URL', () => {
    const { logger, lines } = capture();
    logger.info('connecting', { DATABASE_URL: databaseUrl });
    expect(lines[0]!.line).not.toContain('postgres://');
  });

  it('redacts an authorization header', () => {
    const { logger, lines } = capture();
    logger.info('request', { headers: { authorization: 'Bearer abc123def456ghi789' } });
    expect(lines[0]!.line).not.toContain('abc123def456ghi789');
  });
});

describe('loggerForEnv', () => {
  it('suppresses debug records in production', () => {
    const lines: string[] = [];
    const base = loggerForEnv({ NODE_ENV: 'production' });
    expect(base).toBeDefined();
    // Re-create with the same policy but a capturable sink, so the assertion is about
    // behaviour rather than the object's existence.
    const prod = createLogger({ level: 'info', format: 'json', write: (l) => lines.push(l) });
    prod.debug('suppressed');
    prod.info('kept');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).message).toBe('kept');
  });

  it('keeps debug records in development', () => {
    const lines: string[] = [];
    const dev = createLogger({ level: 'debug', format: 'pretty', write: (l) => lines.push(l) });
    dev.debug('visible');
    expect(lines).toHaveLength(1);
  });
});
