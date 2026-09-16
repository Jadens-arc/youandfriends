/**
 * The three voices of the Studio Notebook system (docs/DESIGN.md §11).
 *
 * `next/font/google` **downloads these at build time and serves them from our own origin**.
 * There is no runtime request to a third-party font CDN, so the privacy requirement is met:
 * a visitor's IP and browsing pattern never reach a font provider. It also generates adjusted
 * fallback metrics automatically, which is what keeps the swap from shifting layout.
 */

import { IBM_Plex_Mono, Inter, Newsreader } from 'next/font/google';

/** Editorial serif — project and song titles, major headings, the wordmark. */
export const serif = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
  // The ampersand in "You & Friends" may use an italic optical variant (docs/DESIGN.md §16).
  style: ['normal', 'italic'],
  weight: ['400', '500', '600'],
});

/** Neutral sans — controls, navigation, metadata, dense lists. */
export const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/** Restrained monospace — lyrics and timestamps. Monospace digits are tabular by nature. */
export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
  weight: ['400', '500'],
});

/**
 * Applied once on `<html>` so every family is available as a CSS variable.
 *
 * These deliberately do NOT use the `--font-serif` / `--font-sans` / `--font-mono` names.
 * Those belong to the design system's `@theme` block, which composes them with a system
 * fallback chain. Two definitions of the same custom property at root scope would be a
 * specificity coin-flip.
 */
export const fontVariables = `${serif.variable} ${sans.variable} ${mono.variable}`;
