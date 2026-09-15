/**
 * Shared configuration for You & Friends.
 *
 * Environment parsing, structured logging, and observability hooks land here in task `002`.
 * Today this package exists so the dependency direction in `docs/ARCHITECTURE.md` §3 is real
 * from the first commit rather than retrofitted.
 */

/** Product identity. The ampersand is part of the name — see `docs/DESIGN.md` §16. */
export const PRODUCT_NAME = 'You & Friends' as const;
export const PRODUCT_ATTRIBUTION = 'by Avery and Friends' as const;
export const PRODUCT_TAGLINE = 'Where songs live between sessions.' as const;
export const PRODUCT_DOMAIN = 'youandfriends.org' as const;

/**
 * Prefix for product-specific environment variables. Provider SDKs keep their own
 * conventional names (`CLERK_SECRET_KEY`, `DATABASE_URL`, …).
 */
export const ENV_PREFIX = 'YOUANDFRIENDS_' as const;
