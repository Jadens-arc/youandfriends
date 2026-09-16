// Dependency-direction rules for the monorepo (docs/ARCHITECTURE.md §3).
//
// Dependencies point inward. These are enforced mechanically rather than by convention,
// because a boundary that is merely documented is a boundary that erodes.
//
// Task `022` adds the most important one: a route handler may not import
// `@youandfriends/db` without going through `@youandfriends/authz`.

import tseslint from 'typescript-eslint';

const INFRASTRUCTURE = [
  '@youandfriends/db',
  '@youandfriends/storage',
  '@youandfriends/authz',
  '@youandfriends/media',
  '@youandfriends/ui',
];

const UI_FRAMEWORK = ['react', 'react-dom', 'next'];

/**
 * `contracts` defines shapes, not behaviour. If it could import `db` it would become a place
 * to put queries, and the dependency graph would go circular within a week.
 */
export const contractsBoundary = tseslint.config({
  files: ['**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          ...INFRASTRUCTURE.map((name) => ({
            name,
            message:
              'contracts defines shapes only. It must not depend on infrastructure — see docs/ARCHITECTURE.md §3.',
          })),
          ...UI_FRAMEWORK.map((name) => ({
            name,
            message:
              'contracts is shared with server code and must stay framework-free — see docs/ARCHITECTURE.md §3.',
          })),
        ],
        patterns: [
          {
            group: ['react/*', 'react-dom/*', 'next/*'],
            message:
              'contracts is shared with server code and must stay framework-free — see docs/ARCHITECTURE.md §3.',
          },
        ],
      },
    ],
  },
});

/**
 * No raw colour literals in components.
 *
 * Colours are defined once, in `packages/ui/src/tokens.ts` and mirrored into `tokens.css`.
 * A hex or rgb() literal in a component is how a design system stops being a system —
 * CLAUDE.md §13. Token files themselves are exempt, since that is where the values live.
 */
export const noRawColors = tseslint.config({
  files: ['**/*.{ts,tsx}'],
  ignores: ['**/tokens.ts', '**/tokens.test.ts', '**/contrast.ts', '**/contrast.test.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
        message:
          'Raw colour literal. Use a Studio Notebook token — see packages/ui/src/tokens.ts and docs/DESIGN.md §11.',
      },
      {
        selector: 'Literal[value=/rgba?\\(/]',
        message:
          'Raw colour literal. Use a Studio Notebook token — see packages/ui/src/tokens.ts and docs/DESIGN.md §11.',
      },
      {
        selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]',
        message:
          'Raw colour literal in a template string. Use a Studio Notebook token — see packages/ui/src/tokens.ts.',
      },
    ],
  },
});

export default contractsBoundary;
