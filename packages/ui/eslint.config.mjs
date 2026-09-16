import config from '@youandfriends/config/eslint/react';
import { noRawColors } from '@youandfriends/config/eslint/boundaries';

// Colours come from tokens — see docs/DESIGN.md §11.
export default [...config, ...noRawColors];
