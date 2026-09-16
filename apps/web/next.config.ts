import type { NextConfig } from 'next';

import { isShowcaseEnabled, SHOWCASE_PAGE_EXTENSION } from './lib/showcase';

const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

const nextConfig: NextConfig = {
  // Internal packages are consumed as source and transpiled here — see ADR 0007.
  transpilePackages: ['@youandfriends/config', '@youandfriends/contracts', '@youandfriends/ui'],
  typedRoutes: true,

  /**
   * The component showcase's route files are named `page.dev.tsx`, so they are routes only
   * while `dev.tsx` is recognised as a page extension. In production it is dropped and the
   * route is absent from the build output — not hidden, not unlinked, not 404ing from a
   * handler that still exists. `proxy.ts` is the second lock.
   *
   * The file is still typechecked and linted either way; only routing changes.
   */
  pageExtensions: isShowcaseEnabled()
    ? [SHOWCASE_PAGE_EXTENSION, ...DEFAULT_PAGE_EXTENSIONS]
    : DEFAULT_PAGE_EXTENSIONS,
};

export default nextConfig;
