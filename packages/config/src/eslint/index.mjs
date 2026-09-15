// Shared ESLint flat config for You & Friends.
//
// Every workspace extends this. Rules that protect an invariant from CLAUDE.md live here so
// they cannot drift per package. Later tasks add to this file rather than forking it:
//   `010` no raw color literals · `022` no unscoped `db` import in route handlers.

import js from '@eslint/js';
import noSecrets from 'eslint-plugin-no-secrets';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Paths that are never linted, in any workspace. */
export const ignores = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/target/**',
  '**/next-env.d.ts',
];

/** Base configuration: TypeScript, import hygiene, and secret detection. */
export const base = tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { 'no-secrets': noSecrets },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // A high-entropy literal in source is usually a leaked credential.
      // CLAUDE.md §8: a committed secret is a compromised secret.
      'no-secrets/no-secrets': ['error', { tolerance: 4.2 }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
    },
  },
  {
    // Tests and scripts may log freely, and fixtures legitimately contain
    // high-entropy strings that are not credentials.
    files: [
      '**/*.test.{ts,tsx}',
      '**/__tests__/**/*.{ts,tsx}',
      '**/fixtures/**',
      'scripts/**/*.mjs',
      '**/*.config.{ts,mts,mjs}',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      'no-secrets/no-secrets': 'off',
    },
  },
);

export default base;
