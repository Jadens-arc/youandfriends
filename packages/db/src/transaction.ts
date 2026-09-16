import { redact } from '@youandfriends/config';

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
    throw new TransactionError(cause);
  }
}
