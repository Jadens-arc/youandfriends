// React/JSX ESLint configuration for component workspaces (`packages/ui`, `apps/web`).
//
// Accessibility linting (`eslint-plugin-jsx-a11y`) arrives with task `012`, when there are
// components for it to check. CLAUDE.md §13 keeps accessibility in acceptance criteria
// meanwhile.

import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import { base } from './index.mjs';

export const react = tseslint.config(...base, {
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    globals: { ...globals.browser, ...globals.node },
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
  },
});

export default react;
