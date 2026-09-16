/**
 * Environment configuration for You & Friends.
 *
 * Parsed once, validated with Zod, and failed loudly at startup. A misconfigured deployment
 * should break immediately with a precise message rather than later, confusingly, during an
 * upload.
 *
 * Two rules hold here:
 *   - Every problem is reported at once. Fixing one variable per deploy is miserable.
 *   - Server secrets are structurally unavailable to client code — enforced by types, not by
 *     convention (docs/THREAT_MODEL.md T9).
 */

import { z } from 'zod';

/** Variables the browser may see. Every one must carry the `NEXT_PUBLIC_` prefix. */
const publicSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

const byteCount = z.coerce.number().int().positive();
const seconds = z.coerce.number().int().positive();

/** Variables that must never reach the browser. */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Neon Postgres. The unpooled URL is required for migrations and transactional jobs,
  // because the serverless HTTP driver cannot hold an interactive transaction (ADR 0007).
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Cloudflare R2, S3-compatible (ADR 0001).
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_ORIGINALS: z.string().min(1).optional(),
  R2_BUCKET_DERIVATIVES: z.string().min(1).optional(),
  R2_ENDPOINT: z.string().url().optional(),

  LIVEBLOCKS_SECRET_KEY: z.string().min(1).optional(),

  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  TRIGGER_PROJECT_ID: z.string().min(1).optional(),
  TRIGGER_API_URL: z.string().url().optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_ADDRESS: z.string().email().optional(),

  SENTRY_DSN: z.string().url().optional(),

  // Product quotas. Configurable rather than hard-coded, per ADR 0001.
  YOUANDFRIENDS_MAX_OBJECT_BYTES: byteCount.default(2_147_483_648),
  YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES: byteCount.default(107_374_182_400),
  YOUANDFRIENDS_DERIVATIVE_BITRATE: z
    .string()
    .regex(/^\d+k$/)
    .default('192k'),
  YOUANDFRIENDS_STREAM_URL_TTL_SECONDS: seconds.max(3600).default(900),
  YOUANDFRIENDS_DOWNLOAD_URL_TTL_SECONDS: seconds.max(3600).default(300),
  YOUANDFRIENDS_RECOVERY_WINDOW_DAYS: seconds.default(30),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema> & PublicEnv;

/**
 * Compile-time guard: a public env object may only carry `NEXT_PUBLIC_`-prefixed keys.
 *
 * If someone adds a secret to `publicSchema`, this fails to typecheck rather than shipping
 * the secret to the browser.
 */
type OnlyPublicKeys<T> = {
  [K in keyof T]: K extends `NEXT_PUBLIC_${string}` ? T[K] : never;
};
const _publicKeysAreAllPublic: OnlyPublicKeys<PublicEnv> = {} as PublicEnv;
void _publicKeysAreAllPublic;

/** Thrown when the environment is invalid. Lists every problem, not just the first. */
export class EnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'See .env.example for every variable, what it is for, and where to obtain it.',
    );
    this.name = 'EnvironmentError';
    this.problems = problems;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parse and validate server environment. Throws {@link EnvironmentError} listing every
 * problem at once.
 */
export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const server = serverSchema.safeParse(source);
  const pub = publicSchema.safeParse(source);

  const problems = [
    ...(server.success ? [] : formatIssues(server.error)),
    ...(pub.success ? [] : formatIssues(pub.error)),
  ];

  if (problems.length > 0) throw new EnvironmentError(problems);
  // Both succeeded, so the non-null assertions below are sound.
  return { ...server.data!, ...pub.data! };
}

/**
 * Parse the browser-visible subset. Safe to call in client code — it cannot return a secret,
 * because `publicSchema` structurally cannot contain one.
 */
export function parsePublicEnv(
  source: Record<string, string | undefined> = process.env,
): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) throw new EnvironmentError(formatIssues(result.error));
  return result.data;
}

/**
 * Assert that the variables a feature needs are present, reporting every missing one at once.
 *
 * Provider variables are optional at parse time because the product is built in slices — the
 * design system does not need a database, and refusing to boot without R2 credentials would
 * block work that has nothing to do with storage. Requiredness therefore belongs at the point
 * of use: the storage driver demands its own keys, the database client demands its own.
 *
 * @example
 * requireServerEnv(env, ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']);
 */
export function requireServerEnv<K extends keyof ServerEnv>(
  env: ServerEnv,
  keys: readonly K[],
): asserts env is ServerEnv & { [P in K]-?: NonNullable<ServerEnv[P]> } {
  const missing = keys.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    throw new EnvironmentError(missing.map((key) => `${String(key)}: required but not set`));
  }
}

/** True when a Sentry DSN is configured, which selects the real reporter over the no-op. */
export function hasSentryDsn(
  env: Pick<ServerEnv, 'SENTRY_DSN' | 'NEXT_PUBLIC_SENTRY_DSN'>,
): boolean {
  return Boolean(env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN);
}
