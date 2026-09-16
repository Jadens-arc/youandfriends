/**
 * Where the component showcase is allowed to exist.
 *
 * The showcase is a development aid, not a product surface. `docs/THREAT_MODEL.md` treats an
 * unlisted route as a reachable route, so this is not about hiding a link: the showcase's
 * page file is excluded from the production build by `pageExtensions` in `next.config.ts`,
 * and `proxy.ts` refuses the path as a second lock. Both read this one predicate.
 *
 * Preview deployments keep it, because reviewing the design system against a real deployment
 * is the reason it exists. `VERCEL_ENV` is `preview` there while `NODE_ENV` is `production`,
 * so the two checks are not interchangeable.
 */
export function isShowcaseEnabled(
  env: { NODE_ENV?: string | undefined; VERCEL_ENV?: string | undefined } = process.env,
): boolean {
  if (env.VERCEL_ENV === 'preview') return true;
  return env.NODE_ENV !== 'production';
}

/** The showcase's path. Exported so the gate and its tests cannot drift from the route. */
export const SHOWCASE_PATH = '/_showcase';

/**
 * The file extension the showcase's route files carry.
 *
 * `page.dev.tsx` is a route only while `dev.tsx` is in `pageExtensions`. Dropping it from
 * that list removes the route from the build output entirely — there is no handler left to
 * return anything, which is a stronger guarantee than a handler that decides to 404.
 */
export const SHOWCASE_PAGE_EXTENSION = 'dev.tsx';
