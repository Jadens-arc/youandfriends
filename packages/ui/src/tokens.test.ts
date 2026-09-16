import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AA_NORMAL, contrastRatio, luminance } from './contrast';
import { accent, border, motion, radius, surface, text, TEXT_ON_SURFACE_PAIRS } from './tokens';

// Resolved from the package root: under jsdom, `import.meta.url` is not a file:// URL.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

describe('contrast — WCAG 2.2 AA', () => {
  // This is a gate, not a report. A palette change that breaks contrast fails the build
  // rather than shipping and being discovered in task `121`.
  it.each(TEXT_ON_SURFACE_PAIRS)('$name meets AA', ({ foreground, background }) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('covers every text colour the system defines', () => {
    const covered = new Set(TEXT_ON_SURFACE_PAIRS.map((p) => p.foreground.toLowerCase()));
    for (const value of [text.ink, text.secondary, text.secondaryOnEspresso, text.onEspresso]) {
      expect(covered).toContain(value.toLowerCase());
    }
    // Every accent's text variant must be covered too.
    for (const value of [accent.oliveText, accent.rustText, accent.ochreText]) {
      expect(covered).toContain(value.toLowerCase());
    }
  });

  it('documents why base accents are not text colours', () => {
    // If one of these ever clears AA on its own, the -text variant is redundant and the
    // split should be revisited. Until then this asserts the reason the split exists.
    for (const base of [accent.olive, accent.rust, accent.ochre]) {
      expect(contrastRatio(base, surface.canvas)).toBeLessThan(AA_NORMAL);
    }
  });

  it('computes luminance correctly at the extremes', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });

  it('rejects a malformed colour rather than silently scoring it', () => {
    expect(() => luminance('not-a-colour')).toThrow();
    expect(() => luminance('#FFF')).toThrow();
  });
});

describe('tokens.css mirrors tokens.ts', () => {
  // Two sources of truth is one too many. This asserts they agree.
  const expectations: Array<[string, string]> = [
    ['--color-canvas', surface.canvas],
    ['--color-paper', surface.paper],
    ['--color-espresso', surface.espresso],
    ['--color-ink', text.ink],
    ['--color-secondary', text.secondary],
    ['--color-secondary-on-espresso', text.secondaryOnEspresso],
    ['--color-olive', accent.olive],
    ['--color-olive-text', accent.oliveText],
    ['--color-rust', accent.rust],
    ['--color-rust-text', accent.rustText],
    ['--color-ochre', accent.ochre],
    ['--color-ochre-text', accent.ochreText],
    ['--color-border', border.DEFAULT],
    ['--radius-sm', radius.sm],
    ['--radius-lg', radius.lg],
    ['--duration-fast', motion.fast],
    ['--duration-slow', motion.slow],
  ];

  it.each(expectations)('%s matches', (name, value) => {
    const match = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
    expect(match, `${name} is missing from tokens.css`).not.toBeNull();
    expect(match![1]!.trim().toLowerCase()).toBe(value.toLowerCase());
  });
});

describe('design invariants from docs/DESIGN.md §11', () => {
  it('keeps radii in the 8–14px band, reserving `full` for circular elements', () => {
    const banded = [radius.sm, radius.DEFAULT, radius.md, radius.lg];
    for (const value of banded) {
      const px = Number.parseInt(value, 10);
      expect(px).toBeGreaterThanOrEqual(8);
      expect(px).toBeLessThanOrEqual(14);
    }
    expect(radius.full).toBe('9999px');
  });

  it('keeps durations in the 150–220ms band', () => {
    for (const value of [motion.fast, motion.DEFAULT, motion.slow]) {
      const ms = Number.parseInt(value, 10);
      expect(ms).toBeGreaterThanOrEqual(150);
      expect(ms).toBeLessThanOrEqual(220);
    }
  });

  it('tints shadows and borders with ink, never neutral black', () => {
    for (const value of Object.values(border)) {
      expect(value).toMatch(/rgb\((36 28 23|243 238 227)/);
    }
    expect(tokensCss).not.toMatch(/rgba?\(0\s*,?\s*0\s*,?\s*0/);
  });

  it('collapses motion to zero under prefers-reduced-motion, at the token layer', () => {
    expect(tokensCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const block = tokensCss.slice(tokensCss.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/--duration-fast:\s*0ms/);
    expect(block).toMatch(/--duration:\s*0ms/);
    expect(block).toMatch(/--duration-slow:\s*0ms/);
  });

  it('exposes shadcn semantic aliases so components never address the raw palette', () => {
    for (const alias of [
      '--color-background',
      '--color-foreground',
      '--color-card',
      '--color-muted-foreground',
      '--color-ring',
      '--color-destructive',
    ]) {
      expect(tokensCss).toContain(alias);
    }
  });

  it('maps destructive to the AA-safe rust variant, not the decorative one', () => {
    expect(tokensCss).toMatch(/--color-destructive:\s*var\(--color-rust-text\)/);
  });
});
