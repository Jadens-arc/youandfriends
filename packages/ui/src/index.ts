/**
 * `@youandfriends/ui`
 *
 * The Studio Notebook design system: tokens, and shadcn/Radix primitives restyled onto them.
 *
 * Stylesheets are consumed directly:
 *   `@import '@youandfriends/ui/styles/tokens.css';`
 */

export const PACKAGE_NAME = '@youandfriends/ui' as const;

export { AA_LARGE, AA_NON_TEXT, AA_NORMAL, contrastRatio, luminance } from './contrast';
export {
  accent,
  border,
  fontRole,
  motion,
  radius,
  shadow,
  surface,
  text,
  tokens,
  type,
  TEXT_ON_SURFACE_PAIRS,
} from './tokens';

export { cn } from './lib/cn';
export { usePrefersReducedMotion } from './lib/use-prefers-reduced-motion';
export {
  disabledState,
  focusRing,
  focusRingOnEspresso,
  touchTarget,
  transition,
} from './lib/focus';

export * from './components/badge';
export * from './components/bottom-sheet';
export * from './components/button';
export * from './components/checkbox';
export * from './components/command';
export * from './components/context-menu';
export * from './components/dialog';
export * from './components/display';
export * from './components/dropdown-menu';
export * from './components/input';
export * from './components/select';
export * from './components/sheet';
export * from './components/slider';
export * from './components/split-pane';
export * from './components/tabs';
export * from './components/toast';
export * from './components/tooltip';
