import { accent, shadow, surface, text } from '@youandfriends/ui/tokens';
import { describe, expect, it } from 'vitest';

import { clerkAppearance } from '../appearance';

/**
 * Clerk renders its own markup and cannot inherit the Tailwind theme, so it is handed values.
 * The only thing worth asserting is that those values come from the token module rather than
 * being retyped — a raw hex is a lint failure everywhere else in this repository, and the
 * sign-in page is the one screen every person sees.
 */
describe('Clerk in Studio Notebook', () => {
  it('takes every colour from the tokens', () => {
    const variables = clerkAppearance.variables ?? {};

    expect(variables.colorBackground).toBe(surface.paper);
    expect(variables.colorForeground).toBe(text.ink);
    expect(variables.colorMutedForeground).toBe(text.secondary);
    expect(variables.colorInput).toBe(surface.canvas);
    expect(variables.colorPrimary).toBe(accent.oliveText);
    expect(variables.colorDanger).toBe(accent.rustText);
  });

  it('uses the text-carrying accent variants, not the decorative ones', () => {
    // `accent.olive` and `accent.rust` are fills. Their `*Text` siblings exist because the
    // fill values do not reach contrast on the cream ground (`docs/DESIGN.md` §11), and a
    // primary button label is text.
    const variables = clerkAppearance.variables ?? {};
    expect(variables.colorPrimary).not.toBe(accent.olive);
    expect(variables.colorDanger).not.toBe(accent.rust);
  });

  it('does not pin a font family', () => {
    // Clerk inherits the page's, which `next/font` loads as a CSS variable. Naming a family
    // here would pin a fallback that ignores it.
    const variables = clerkAppearance.variables ?? {};
    expect('fontFamily' in variables).toBe(false);
  });

  it('gives the card the ink-tinted elevation the rest of the product uses', () => {
    // Clerk's default is a neutral-grey shadow, which reads as cold on the cream ground.
    // Read through a record: Clerk's `Elements` type is writable by key but not indexable by
    // one, so the property cannot be read back off it directly.
    const elements = clerkAppearance.elements as Record<string, unknown> | undefined;
    expect(elements?.card).toMatchObject({ boxShadow: shadow.raised });
  });
});
