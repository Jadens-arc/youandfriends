/**
 * Type declarations for `boundaries.mjs`.
 *
 * The flat configs stay as `.mjs` because `eslint.config.mjs` imports them at runtime as
 * plain ESM. This gives TypeScript the shape so the regression guard in `boundaries.test.ts`
 * can import them under `tsc --noEmit`.
 */

import type { Linter } from 'eslint';

/** Forbids `contracts` from importing infrastructure, drivers, or a UI framework. */
export declare const contractsBoundary: Linter.Config[];

/** Forbids raw colour literals in component workspaces. */
export declare const noRawColors: Linter.Config[];

declare const _default: Linter.Config[];
export default _default;
