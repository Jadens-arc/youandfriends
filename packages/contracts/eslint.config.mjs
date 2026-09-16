import config from '@youandfriends/config/eslint';
import { contractsBoundary } from '@youandfriends/config/eslint/boundaries';

// contracts defines shapes only — see docs/ARCHITECTURE.md §3.
export default [...config, ...contractsBoundary];
