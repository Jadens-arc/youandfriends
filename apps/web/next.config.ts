import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Internal packages are consumed as source and transpiled here — see ADR 0007.
  transpilePackages: ['@youandfriends/config', '@youandfriends/contracts', '@youandfriends/ui'],
  typedRoutes: true,
};

export default nextConfig;
