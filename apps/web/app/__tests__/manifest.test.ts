import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { surface } from '@youandfriends/ui/tokens';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '../manifest';

describe('the web app manifest', () => {
  const m = manifest();

  it('carries the product name with the ampersand, unescaped', () => {
    // This is JSON, not HTML. `&amp;` here would put those five literal characters under the
    // icon on someone's Home Screen (`docs/DESIGN.md` §16).
    expect(m.name).toBe(PRODUCT_NAME);
    expect(m.name).toContain('&');
    expect(m.name).not.toContain('&amp;');
    expect(m.short_name).not.toContain('&amp;');
    expect(m.description).toBe(PRODUCT_TAGLINE);
  });

  it('takes its colours from the tokens rather than retyping them', () => {
    expect(m.background_color).toBe(surface.canvas);
    expect(m.theme_color).toBe(surface.espresso);
  });

  it('is standalone and starts at the workspace', () => {
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
  });

  it('declares the two sizes an install actually requires', () => {
    const any = (m.icons ?? []).filter((icon) => icon.purpose === 'any');
    expect(any.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('declares maskable icons, so Android does not crop the glyph', () => {
    const maskable = (m.icons ?? []).filter((icon) => icon.purpose === 'maskable');
    expect(maskable).toHaveLength(2);
    // They must be different files from the `any` set. Declaring the same file maskable is the
    // common mistake, and it gets the ampersand's shoulders cut off.
    const anySrcs = new Set((m.icons ?? []).filter((i) => i.purpose === 'any').map((i) => i.src));
    for (const icon of maskable) expect(anySrcs.has(icon.src)).toBe(false);
  });

  it('points at files that exist', () => {
    // A manifest naming an icon that is not there is a silently uninstallable app: the browser
    // rejects the whole manifest and the install prompt simply never appears.
    for (const icon of m.icons ?? []) {
      expect(existsSync(join(process.cwd(), 'public', icon.src)), `${icon.src} missing`).toBe(true);
    }
  });
});
