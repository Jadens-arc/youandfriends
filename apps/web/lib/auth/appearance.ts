import type { SignIn } from '@clerk/nextjs';
import type { ComponentProps } from 'react';

import { accent, border, radius, shadow, surface, text } from '@youandfriends/ui/tokens';

/**
 * Clerk's appearance type, derived from the component rather than imported from a package.
 *
 * `@clerk/types` is not a declared dependency of `@clerk/nextjs` in v7, so importing it would
 * mean depending on a hoisting accident. Reading the prop off `SignIn` cannot drift from the
 * installed version, which is the property worth having.
 */
type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>['appearance']>;

/**
 * Clerk's components, in Studio Notebook.
 *
 * Clerk renders its own markup, so it cannot inherit the Tailwind theme the rest of the app
 * uses — it has to be handed values. They come from `@youandfriends/ui/tokens`, the same source
 * the theme is generated from, rather than being retyped as hex here: a raw hex in a component
 * is a lint failure everywhere else in this repository (`docs/DESIGN.md` §11), and the sign-in
 * page drifting from the product it is the front door to would be visible on the one screen
 * every person sees first.
 *
 * What is deliberately *not* set: fonts. Clerk inherits them from the page, and naming a family
 * here would pin a fallback that ignores `next/font`'s loaded variable.
 */
export const clerkAppearance: ClerkAppearance = {
  variables: {
    colorPrimary: accent.oliveText,
    colorBackground: surface.paper,
    colorForeground: text.ink,
    colorMutedForeground: text.secondary,
    colorInput: surface.canvas,
    colorInputForeground: text.ink,
    colorDanger: accent.rustText,
    borderRadius: radius.DEFAULT,
  },
  elements: {
    // The card is paper on the canvas, with the same ink-tinted elevation as every other
    // raised surface. Clerk's default is a neutral-grey shadow that reads as cold here.
    card: { boxShadow: shadow.raised, border: `1px solid ${border.subtle}` },
  },
  // Clerk's own footer branding is left alone. Hiding it is a plan-dependent term of theirs,
  // not a design decision to make unilaterally, and the layout above already says whose door
  // this is.
};
