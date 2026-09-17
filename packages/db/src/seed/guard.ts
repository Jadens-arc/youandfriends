/**
 * The seed must never run against production.
 *
 * It writes fabricated users, fabricated grants, and fabricated content into whatever database
 * it is pointed at, and `--reset` deletes. Against a real workspace that is a catastrophe with
 * no undo, so the check **fails closed**: anything other than an explicitly recognised
 * development or test environment, pointed at an explicitly recognised development or test
 * *database*, is a refusal.
 *
 * Fails closed matters more than it sounds. The obvious shape — "refuse if NODE_ENV is
 * production" — permits an unset `NODE_ENV`, which is exactly what a hastily-run one-off shell
 * has.
 *
 * **The environment label is not the target.** `NODE_ENV=development` says where the process
 * thinks it is running, not what it is about to write to, and `.env.local` is exactly where a
 * developer debugging an incident puts a production connection string. So the host is checked
 * too: local by default, anything else only when the operator names it in
 * `YOUANDFRIENDS_SEED_ALLOW_HOST`. Task `027`'s acceptance criterion is "refuses to run against
 * a production database", and checking only the label would not have met it.
 */

export const SEED_ALLOWED_ENVIRONMENTS = ['development', 'test'] as const;

/**
 * Hosts a seed may write to without being named.
 *
 * Loopback only. A Neon branch, a staging box, a colleague's machine — all of them have to be
 * spelled out, because none of them can be recognised as safe from the string alone.
 */
export const SEED_LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', ''] as const;

/** The variable that names a non-local host the operator accepts responsibility for. */
export const SEED_ALLOW_HOST_VAR = 'YOUANDFRIENDS_SEED_ALLOW_HOST';

export interface SeedEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
  readonly DATABASE_URL_UNPOOLED?: string | undefined;
  readonly [SEED_ALLOW_HOST_VAR]?: string | undefined;
}

export class SeedRefusedError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to seed: ${reason}.\n` +
        'The seed writes fabricated data and --reset deletes. It runs only with ' +
        `NODE_ENV in {${SEED_ALLOWED_ENVIRONMENTS.join(', ')}}, VERCEL_ENV unset or non-production, ` +
        `and a local database — or a host named in ${SEED_ALLOW_HOST_VAR}.`,
    );
    this.name = 'SeedRefusedError';
  }
}

/**
 * Proof that {@link assertSeedAllowed} ran and allowed this.
 *
 * `seed` and `reset` require one, so neither can be called by a path that skipped the guard.
 * The type cannot be constructed anywhere else — containment by construction rather than by
 * which symbols happen to be exported today.
 */
declare const permitBrand: unique symbol;

export interface SeedPermit {
  readonly [permitBrand]: true;
  /** The host the guard approved, for the CLI to print before it writes. */
  readonly host: string;
}

/** The host a Postgres URL points at, lowercased, or `null` when it cannot be parsed. */
export function seedTargetHost(url: string): string | null {
  try {
    // `postgresql://` is not a special scheme to WHATWG URL, but hostname still parses.
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Throws unless this is unambiguously a development or test environment **and** the database it
 * would write to is unambiguously a development or test database.
 */
export function assertSeedAllowed(env: SeedEnvironment): SeedPermit {
  const nodeEnv = env.NODE_ENV;

  if (nodeEnv === undefined || nodeEnv === '') {
    // Not "assume development". An unset NODE_ENV is the state of a shell someone opened to
    // run one command against a connection string they pasted.
    throw new SeedRefusedError('NODE_ENV is not set, so the environment is unknown');
  }

  if (!SEED_ALLOWED_ENVIRONMENTS.includes(nodeEnv as (typeof SEED_ALLOWED_ENVIRONMENTS)[number])) {
    throw new SeedRefusedError(`NODE_ENV is ${nodeEnv}`);
  }

  // Vercel builds previews with NODE_ENV=production, and a preview's database may be the real
  // one. Checked separately because the two variables mean different things.
  if (env.VERCEL_ENV === 'production') {
    throw new SeedRefusedError('VERCEL_ENV is production');
  }

  const url = env.DATABASE_URL_UNPOOLED;
  if (url === undefined || url === '') {
    throw new SeedRefusedError('DATABASE_URL_UNPOOLED is not set, so there is nothing to seed');
  }

  const host = seedTargetHost(url);
  if (host === null) {
    // A URL we cannot parse is a URL we cannot vouch for.
    throw new SeedRefusedError('DATABASE_URL_UNPOOLED is not a URL whose host can be read');
  }

  const allowed = env[SEED_ALLOW_HOST_VAR];
  const isLocal = SEED_LOCAL_HOSTS.includes(host as (typeof SEED_LOCAL_HOSTS)[number]);
  // Exact match, never a suffix: `prod.example.com` must not be permitted by `example.com`.
  const isNamed = allowed !== undefined && allowed !== '' && allowed.toLowerCase() === host;

  if (!isLocal && !isNamed) {
    throw new SeedRefusedError(
      `DATABASE_URL_UNPOOLED points at ${host}, which is not local and is not named in ` +
        `${SEED_ALLOW_HOST_VAR}`,
    );
  }

  return { host } as SeedPermit;
}
