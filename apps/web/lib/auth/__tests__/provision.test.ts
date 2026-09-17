import { users, type PooledDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { newUlid } from '@youandfriends/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findUserByClerkId, provisionUser } from '../provision';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) {
  console.warn(`SKIPPING provisioning tests: ${reason}`);
}

/**
 * Just-in-time user creation, against a real Postgres.
 *
 * The unique index is the mechanism, so a fake would test nothing: the whole question is what
 * the database does when two inserts race, and only a database can answer it.
 */
describeWithDatabase('provisioning a user from a Clerk identity', () => {
  let database: TestDatabase;
  let db: PooledDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('auth_provision');
    // The provisioning code is written against the pooled type; the harness hands out a direct
    // connection. Same SQL either way — the brands separate driver choice, not dialect.
    db = database.db as unknown as PooledDatabase;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const identity = (suffix: string) => ({
    clerkUserId: `user_${suffix}`,
    email: `${suffix}@example.test`,
    displayName: 'Avery',
  });

  it('creates the row on first sight, and says it created it', async () => {
    const result = await provisionUser(db, identity('first'), newUlid);

    expect(result.created).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(row?.clerkUserId).toBe('user_first');
    expect(row?.email).toBe('first@example.test');
  }, 60_000);

  it('returns the same row on every later sign-in', async () => {
    const first = await provisionUser(db, identity('repeat'), newUlid);
    const second = await provisionUser(db, identity('repeat'), newUlid);

    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
  }, 60_000);

  it('creates exactly one row when the first sign-in arrives as a stampede', async () => {
    // The case this function exists for. A first sign-in commonly arrives as several requests
    // at once — a page, its data, a prefetch — and a read-then-insert would have all of them
    // read "absent" and all of them insert. Ten at once, deliberately not awaited in turn.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => provisionUser(db, identity('stampede'), newUlid)),
    );

    const ids = new Set(results.map((result) => result.userId));
    expect(ids.size, 'every caller must get the same id').toBe(1);

    const rows = await db.select().from(users).where(eq(users.clerkUserId, 'user_stampede'));
    expect(rows).toHaveLength(1);

    // Exactly one caller may claim to have created it, or the audit event that hangs off this
    // flag would fire ten times for one sign-in.
    expect(results.filter((result) => result.created)).toHaveLength(1);
  }, 60_000);

  it('refreshes what Clerk owns when it changes', async () => {
    const first = await provisionUser(db, identity('renamed'), newUlid);
    const second = await provisionUser(
      db,
      { clerkUserId: 'user_renamed', email: 'new@example.test', displayName: 'Avery Okafor' },
      newUlid,
    );

    expect(second.userId).toBe(first.userId);
    const [row] = await db.select().from(users).where(eq(users.id, first.userId));
    // `excluded.email`, not `users.email`: the bare table name inside `DO UPDATE` is the row
    // already there, which makes the update a self-assignment that silently does nothing.
    expect(row?.email).toBe('new@example.test');
    expect(row?.displayName).toBe('Avery Okafor');
  }, 60_000);

  it('finds a user by Clerk id without creating one', async () => {
    expect(await findUserByClerkId(db, 'user_never_seen')).toBeNull();

    const created = await provisionUser(db, identity('lookup'), newUlid);
    expect(await findUserByClerkId(db, 'user_lookup')).toEqual({ id: created.userId });

    // And the lookup did not itself provision anything.
    expect(await findUserByClerkId(db, 'user_never_seen')).toBeNull();
  }, 60_000);
});
