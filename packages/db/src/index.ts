/**
 * `@youandfriends/db`
 *
 * Drizzle schema, migrations, and the typed Neon client. The durable record.
 *
 * Implementation arrives in task `020`. This package exists from the first commit so the
 * dependency direction described in `docs/ARCHITECTURE.md` §3 is enforced by the
 * workspace graph rather than by convention.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/db' as const;
