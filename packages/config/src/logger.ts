/**
 * Structured logging.
 *
 * JSON in production so logs are queryable; human-readable in development so they are
 * readable. Every record passes through {@link redact} on the way out, so a careless
 * `log.info({ session })` cannot spill a credential (docs/THREAT_MODEL.md T3, T9).
 *
 * Correlation IDs join a log line to an audit row and to the error a user was shown — the
 * client receives the ID, never the diagnostic detail.
 */

import { redact } from './redact';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  level: LogLevel;
  message: string;
  time: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum level to emit. Records below it are dropped. */
  level?: LogLevel;
  /** `json` for production, `pretty` for development. */
  format?: 'json' | 'pretty';
  /** Fields attached to every record from this logger. */
  bindings?: Record<string, unknown>;
  /** Sink. Defaults to stdout/stderr; injectable for tests. */
  write?: (line: string, level: LogLevel) => void;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Derive a logger that attaches `bindings` to every record — e.g. a correlation ID. */
  child(bindings: Record<string, unknown>): Logger;
}

function defaultWrite(line: string, level: LogLevel): void {
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function formatPretty(record: LogRecord): string {
  const { level, message, time, ...rest } = record;
  const fields = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${time} ${level.toUpperCase().padEnd(5)} ${message}${fields ? ` ${fields}` : ''}`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minRank = LEVEL_RANK[options.level ?? 'info'];
  const format = options.format ?? 'json';
  const write = options.write ?? defaultWrite;
  const bindings = options.bindings ?? {};

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < minRank) return;

    // Redact the whole record, including the message — an interpolated URL or token in a
    // message string is just as much a leak as one in a field.
    const record = redact({
      level,
      message,
      time: new Date().toISOString(),
      ...bindings,
      ...fields,
    }) as LogRecord;

    write(format === 'json' ? JSON.stringify(record) : formatPretty(record), level);
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) =>
      createLogger({
        ...options,
        bindings: { ...bindings, ...extra },
      }),
  };
}

/** Build a logger configured for the current environment. */
export function loggerForEnv(env: { NODE_ENV: string }): Logger {
  const isProduction = env.NODE_ENV === 'production';
  return createLogger({
    level: isProduction ? 'info' : 'debug',
    format: isProduction ? 'json' : 'pretty',
  });
}

/** Generate a correlation ID for a request. */
export function newCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}
