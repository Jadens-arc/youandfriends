/** Type declarations for `index.mjs` — see `boundaries.d.mts` for why these exist. */

import type { Linter } from 'eslint';

/** Paths never linted, in any workspace. */
export declare const ignores: string[];

/** Base configuration: TypeScript, import hygiene, and secret detection. */
export declare const base: Linter.Config[];

declare const _default: Linter.Config[];
export default _default;
