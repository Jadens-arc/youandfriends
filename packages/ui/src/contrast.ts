/**
 * WCAG 2.2 relative luminance and contrast.
 *
 * Small enough to own rather than depend on, and it makes the contrast gate in
 * `tokens.test.ts` runnable with no extra dependency.
 */

/** WCAG 2.2 AA minimum for normal-size text. */
export const AA_NORMAL = 4.5;
/** WCAG 2.2 AA minimum for large text (>=18.66px bold, or >=24px). */
export const AA_LARGE = 3;
/** WCAG 2.2 minimum for UI component boundaries and meaningful graphics. */
export const AA_NON_TEXT = 3;

function channels(color: string): [number, number, number] {
  const hex = color.replace('#', '').trim();
  if (hex.length !== 6) throw new Error(`expected a 6-digit hex colour, received "${color}"`);
  const parse = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    if (Number.isNaN(value)) throw new Error(`invalid hex colour "${color}"`);
    return value / 255;
  };
  return [parse(0), parse(2), parse(4)];
}

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}
