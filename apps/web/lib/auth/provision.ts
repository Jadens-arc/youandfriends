import { createPooledClient, users, type Database, type PooledDatabase } from '@youandfriends/db';
import { parseServerEnv } from '@youandfriends/config';
import { eq, sql } from 'drizzle-orm';

/**
 * Just-in-time provisioning of the `users` row behind a Clerk identity.
 *
 * **Clerk owns the identity; we own the id.** Everything in the schema references
 * `users.id` — never `clerk_user_id` — so changing identity provider is a mapping change here
 * rather than a migration across every table that names a person (`docs/ARCHITECTURE.md` §3).
 * `clerk_user_id` appears in exactly one column, and this is the only file that writes it.
 *
 * **No authorizer here, deliberately.** This runs before there is any workspace to be scoped
 * to: it is the step that turns "a Clerk session exists" into "a row this product can
 * reference". `scopedQuery` needs a workspace id and there is not one yet. Everything
 * downstream of this function goes through `@youandfriends/authz`, and nothing tenant-scoped
 * happens in this file — if that ever changes, this exemption stops being true.
 */

/** What Clerk tells us about the signed-in person. */
export interface ClerkIdentity {
  readonly clerkUserId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface ProvisionResult {
  readonly userId: string;
  /** True when this call created the row rather than finding it. Drives the audit event. */
  readonly created: boolean;
}

/**
 * Find or create the `users` row for a Clerk identity.
 *
 * **Idempotent under concurrency**, which is the whole difficulty. A first sign-in commonly
 * arrives as several requests at once — a page, its data, a prefetch — and a read-then-insert
 * would have all of them read "absent" and all of them insert. `users_clerk_user_id_key` makes
 * that a unique violation rather than a duplicate, and `onConflictDoUpdate` turns the violation
 * into the row the loser wanted: one statement, one round trip, no race to lose.
 *
 * `DO UPDATE` rather than `DO NOTHING` because `DO NOTHING` returns no row on conflict, which
 * would leave a concurrent caller with nothing to return and a second query to write.
 */
export async function provisionUser(
  db: PooledDatabase,
  identity: ClerkIdentity,
  newId: () => string,
): Promise<ProvisionResult> {
  const candidateId = newId();

  const [row] = await db
    .insert(users)
    .values({
      id: candidateId,
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      // Refresh what Clerk owns, so a changed email or name lands on next sign-in. `excluded`
      // is the row we tried to insert; the bare table name would be the row already there,
      // which makes this a self-assignment that silently does nothing.
      set: { email: sql`excluded.email`, displayName: sql`excluded.display_name` },
    })
    .returning({ id: users.id });

  if (!row) {
    // `DO UPDATE` always returns a row, so reaching here means something changed underneath
    // this function rather than a case worth handling optimistically.
    throw new Error(`provisioning returned no row for ${identity.clerkUserId}`);
  }

  return { userId: row.id, created: row.id === candidateId };
}

/** The row behind a Clerk id, or `null`. Read-only; does not provision. */
export async function findUserByClerkId(
  db: Database,
  clerkUserId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  return row ?? null;
}

let pooled: PooledDatabase | null = null;

/**
 * The request-time database handle.
 *
 * Pooled, not direct: this runs in a serverless function where connections are the scarce
 * resource (ADR 0003). Memoized per process so a warm invocation reuses the handle rather than
 * building one per request.
 */
export function authDatabase(): PooledDatabase {
  pooled ??= createPooledClient(parseServerEnv());
  return pooled;
}
