import config from '@youandfriends/config/eslint/react';
import { authzBoundary, noRawColors } from '@youandfriends/config/eslint/boundaries';

export default [
  ...config,
  // Colours come from tokens — see docs/DESIGN.md §11.
  ...noRawColors,
  // Tenant-scoped reads go through the authorizer — ADR 0006.
  ...authzBoundary,
];
