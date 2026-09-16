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
      'no-secrets/no-secrets': [
        'error',
        {
          tolerance: 4.2,
          // ULIDs are high-entropy by construction and entirely public — they appear in
          // URLs and API responses. Exempting the shape is precise; raising the tolerance
          // to accommodate them would blind the rule to real keys of similar length.
          ignoreContent: ['^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'],
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
    },
  },
  {
    // Tests, scripts, and config may log freely.
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
    },
  },
  {
    // Secret detection stays ON for tests.
    //
    // It was previously disabled here, and that hole was not theoretical: during task `002`
    // a realistic provider key in a test fixture passed lint and was caught only by GitHub
    // push protection rejecting the push. By then the value was already in local history.
    //
    // Tests that need a credential-shaped value assemble it at runtime from parts, which
    // keeps both this rule and provider secret scanners quiet without weakening either:
    //
    //   const fakeKey = ['sk', 'live', 'EXAMPLENOTAREAL'].join('_');
    //
    // Only `fixtures/` is exempt, where generated high-entropy data legitimately lives.
    files: ['**/fixtures/**'],
    rules: {
      'no-secrets/no-secrets': 'off',
    },
  },
);

export default base;
