/**
 * `@youandfriends/authz`
 *
 * The single source of permission truth. Scope-chain resolution, capability checks, and audit emission.
 *
 * Implementation arrives in task `022`. This package exists from the first commit so the
 * dependency direction described in `docs/ARCHITECTURE.md` §3 is enforced by the
 * workspace graph rather than by convention.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/authz' as const;
