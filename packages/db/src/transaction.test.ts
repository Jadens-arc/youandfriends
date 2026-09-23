import { conflict } from '@youandfriends/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, unavailableReason, type TestDatabase } from './__tests__/harness';
import { TransactionError, withTransaction } from './transaction';

const reason = unavailableReason();

/**
 * These need a real Postgres. Mocking the driver would prove the mock rolls back, which is
 * not the claim being made.
 *
 * When no server is configured the suite skips **loudly** — `describe.skip` prints the
 * reason, and a silent pass would be a lie in the build output (CLAUDE.md §7).
 */
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING transaction tests: ${reason}`);
}

describeWithDatabase('withTransaction', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('transaction');
    await database.db.execute(sql`create table note (id int primary key, body text not null)`);
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  it('commits when the callback returns', async () => {
    const result = await withTransaction(database.db, async (tx) => {
      await tx.execute(sql`insert into note values (1, 'kept')`);
      return 'done';
    });

    expect(result).toBe('done');
    const rows = await database.db.execute(sql`select body from note where id = 1`);
    expect(rows.rows).toEqual([{ body: 'kept' }]);
  });

  it('rolls back every statement when the callback throws', async () => {
    await expect(
      withTransaction(database.db, async (tx) => {
        await tx.execute(sql`insert into note values (2, 'first')`);
        await tx.execute(sql`insert into note values (3, 'second')`);
        throw new Error('deliberate');
      }),
    ).rejects.toThrow(TransactionError);

    // Both rows, not just the one after the throw. A partial rollback is the bug.
    const rows = await database.db.execute(sql`select id from note where id in (2, 3)`);
    expect(rows.rows).toEqual([]);
  });

  it('rolls back when Postgres itself rejects a statement', async () => {
    await expect(
      withTransaction(database.db, async (tx) => {
        await tx.execute(sql`insert into note values (4, 'ok')`);
        await tx.execute(sql`insert into note values (4, 'duplicate key')`);
      }),
    ).rejects.toThrow(TransactionError);

    const rows = await database.db.execute(sql`select id from note where id = 4`);
    expect(rows.rows).toEqual([]);
  });

  it('lets an AppError the callback threw reach the caller unwrapped, and still rolls back', async () => {
    // Found while building task `032`: `notFound()`/`conflict()` thrown from inside an
    // audited transaction (`withAuditedTransaction` calls this) were arriving at route-level
    // code as an opaque `TransactionError`, so a deliberate 409 read exactly like an
    // unexplained 500 — the one thing `AppError` exists to prevent.
    const original = conflict({ detail: 'already pending' });

    const thrown = await withTransaction(database.db, async (tx) => {
      await tx.execute(sql`insert into note values (5, 'rolled back too')`);
      throw original;
    }).catch((error: unknown) => error);

    expect(thrown).toBe(original);
    expect((thrown as { code?: string }).code).toBe('conflict');

    const rows = await database.db.execute(sql`select id from note where id = 5`);
    expect(rows.rows).toEqual([]);
  });

  it('keeps the original error as the cause', async () => {
    const original = new Error('deliberate');
    const thrown = await withTransaction(database.db, async () => {
      throw original;
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(TransactionError);
    expect((thrown as TransactionError).cause).toBe(original);
  });
});

describe('TransactionError', () => {
  it('never carries a connection string into its message', async () => {
    // `pg` puts the connection string in some connection errors. Surfacing that in a log or
    // an error response leaks DATABASE_URL, which THREAT_MODEL T9 puts on the deny-list.
    const leaky = new Error(
      `connect ECONNREFUSED for ${['postgresql:', '', 'owner:hunter2@db.example.com/yaf'].join('/')}`,
    );
    const error = new TransactionError(leaky);

    expect(error.message).not.toContain('hunter2');
    expect(error.message).toContain('Transaction rolled back');
  });

  it('describes a non-Error throw without inventing detail', () => {
    expect(new TransactionError('a string').message).toContain('unknown error');
  });
});
