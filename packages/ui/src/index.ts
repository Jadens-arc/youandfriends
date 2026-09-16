/**
 * `@youandfriends/ui`
 *
 * The Studio Notebook design system. Tokens today; shadcn primitives arrive in task `012`.
 *
 * Stylesheets are consumed directly:
 *   `@import '@youandfriends/ui/styles/tokens.css';`
 */

export const PACKAGE_NAME = '@youandfriends/ui' as const;

export { AA_LARGE, AA_NON_TEXT, AA_NORMAL, contrastRatio, luminance } from './contrast';
export {
  accent,
  border,
  motion,
  radius,
  shadow,
  surface,
  text,
  tokens,
  TEXT_ON_SURFACE_PAIRS,
} from './tokens';
