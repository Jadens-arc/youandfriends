import config from '@youandfriends/config/eslint/react';
import { noRawColors } from '@youandfriends/config/eslint/boundaries';

// Colours come from tokens — see docs/DESIGN.md §11. `src-tauri` and `core` are Rust.
export default [
  { ignores: ['dist/**', 'src-tauri/**', 'core/**', 'scripts/**'] },
  ...config,
  ...noRawColors,
];
