/**
 * The repository's own ESLint rules, as a plugin.
 *
 * These encode invariants that would otherwise be documentation — the kind that holds until
 * the first hurried afternoon.
 */

import { noUnscopedDb } from './no-unscoped-db.mjs';

/** @type {import('eslint').ESLint.Plugin} */
export const youandfriendsPlugin = {
  meta: { name: '@youandfriends/eslint-plugin', version: '0.1.0' },
  rules: { 'no-unscoped-db': noUnscopedDb },
};
