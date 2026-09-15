/**
 * `@youandfriends/contracts`
 *
 * Zod schemas, shared types, role and capability enums, and the error taxonomy. Every shape that crosses a trust boundary is defined here.
 *
 * Implementation arrives in task `003`. This package exists from the first commit so the
 * dependency direction described in `docs/ARCHITECTURE.md` §3 is enforced by the
 * workspace graph rather than by convention.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/contracts' as const;
