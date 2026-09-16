import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * These assertions read `fonts.ts` as source rather than importing it.
 *
 * `next/font/google` is a build-time transform: the calls only resolve under the Next.js
 * compiler, so importing the module here throws. What a unit test can honestly verify is the
 * configuration — that we self-host, that every family swaps, and that the license document
 * matches what actually ships. The runtime behaviour is verified in the build itself, which
 * emits the `woff2` files and the adjusted fallback metrics.
 */
const fontsSource = readFileSync(resolve(process.cwd(), 'app/fonts.ts'), 'utf8');
const licenses = readFileSync(resolve(process.cwd(), '../../docs/FONT_LICENSES.md'), 'utf8');

const FAMILIES = [
  { symbol: 'Newsreader', documented: 'Newsreader', variable: '--font-newsreader' },
  { symbol: 'Inter', documented: 'Inter', variable: '--font-inter' },
  { symbol: 'IBM_Plex_Mono', documented: 'IBM Plex Mono', variable: '--font-plex-mono' },
] as const;

describe('font loading', () => {
  it.each(FAMILIES)('exposes $documented as a CSS variable', ({ symbol, variable }) => {
    expect(fontsSource).toContain(symbol);
    expect(fontsSource).toContain(variable);
  });

  it('self-hosts rather than linking a font CDN at runtime', () => {
    // `next/font/google` fetches at build time and serves from our own origin. A direct
    // <link> to a CDN would leak every visitor's IP to the provider (docs/DESIGN.md §11).
    expect(fontsSource).toContain("from 'next/font/google'");
    expect(fontsSource).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('uses swap on every family so text is readable before the webfont arrives', () => {
    expect(fontsSource.match(/display: 'swap'/g) ?? []).toHaveLength(FAMILIES.length);
  });

  it("never claims the design system's own font variable names", () => {
    // --font-serif / --font-sans / --font-mono belong to the @theme block in
    // @youandfriends/ui. Two root-scope definitions would be a specificity coin-flip.
    for (const owned of ["'--font-serif'", "'--font-sans'", "'--font-mono'"]) {
      expect(fontsSource).not.toContain(owned);
    }
  });

  it.each(FAMILIES)('documents a license for $documented', ({ documented }) => {
    expect(licenses).toContain(documented);
    expect(licenses).toMatch(new RegExp(`${documented}.*Open Font License`));
  });
});
