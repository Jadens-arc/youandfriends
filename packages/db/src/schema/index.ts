/**
 * The database schema.
 *
 * Empty by design at task `020`: this task stands up the client and the migration toolchain,
 * and task `021` defines the first tables. The module exists now so `client.ts` can be
 * generic over the schema from the start — adding it later would change every call site's
 * inferred types at once.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- tables arrive in `021`.
export type Schema = {};

export const schema = {} satisfies Schema;
