import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for You & Friends.
 *
 * Task `001` moves this into `packages/config` and adds the Next.js and React plugins.
 * Task `010` adds the no-raw-color rule. Task `022` adds `no-unscoped-db`, which forbids a
 * route handler importing `@youandfriends/db` without `@youandfriends/authz`.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/target/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
);
