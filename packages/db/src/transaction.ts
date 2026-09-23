import { redact } from '@youandfriends/config';
import { AppError } from '@youandfriends/contracts';

import type { DirectDatabase } from './client';

/** The transaction handle a callback receives. Drizzle types it as the database itself. */
export type Transaction = Parameters<Parameters<DirectDatabase['transaction']>[0]>[0];

/**
 * Thrown when a transaction rolls back, carrying the cause without carrying the credential.
 *
 * A `pg` connection error stringifies to include the connection string. Surfacing that in a
 * log or an error response would leak `DATABASE_URL`, which `docs/THREAT_MODEL.md` T9 puts on
 * the deny-list. The message is rebuilt from a redacted view rather than passed through.
 */
export class TransactionError extends Error {
  constructor(cause: unknown) {
    super(`Transaction rolled back: ${describe(cause)}`);
    this.name = 'TransactionError';
    this.cause = cause;
  }
}

function describe(cause: unknown): string {
  if (!(cause instanceof Error)) return 'unknown error';

  // `redact` walks values as well as keys, so a connection string appearing inside a message
  // is replaced whether or not it sits under a key the deny-list knows about.
  const safe = redact({ message: cause.message }) as { message: unknown };
  return typeof safe.message === 'string' ? safe.message : 'redacted error';
}

/**
 * The only sanctioned way to run a multi-statement write.
 *
 * Commits when the callback returns and rolls back when it throws — which is Drizzle's own
 * behaviour, not something added here. What this wrapper adds is the type constraint: it
 * takes a {@link DirectDatabase} and nothing else, so a pooled client cannot be passed in.
 * Over HTTP the statements would run as separate requests and a mid-way failure would leave
 * the write half-applied, with no error to say so.
 */
export async function withTransaction<T>(
  db: DirectDatabase,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction((tx) => run(tx));
  } catch (cause) {
    // An `AppError` thrown by the callback already decided its own public shape — `notFound`,
    // `conflict`, and the rest carry a code, an HTTP status, and a message safe to show a
    // client. Wrapping it here would erase all of that behind `TransactionError`'s generic
    // message, and every caller checking `error.publicCode` or `error.code` would see neither:
    // a deliberate 409 would reach a route handler looking exactly like an unexplained 500.
    // What `TransactionError` exists to redact is a *driver* error — a raw `pg` message that
    // can contain a connection string — and an `AppError` is never that.
    if (cause instanceof AppError) throw cause;
    throw new TransactionError(cause);
  }
}
