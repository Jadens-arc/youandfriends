/**
 * iOS launch-image link tags.
 *
 * iOS ignores the manifest's `background_color` and flashes white on launch unless it finds an
 * `apple-touch-startup-image` whose media query matches the device **exactly** — orientation
 * included. So this is a list of resolutions rather than one scalable asset, and it is derived
 * from the same array `scripts/generate-icons.mjs` renders from, so a device added to one
 * cannot go missing from the other.
 */

export interface SplashScreen {
  /** CSS pixels. What the media query matches on. */
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
}

/** Kept in step with `SPLASH_SCREENS` in `scripts/generate-icons.mjs`; a test holds them equal. */
export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { width: 440, height: 956, ratio: 3 },
  { width: 402, height: 874, ratio: 3 },
  { width: 430, height: 932, ratio: 3 },
  { width: 393, height: 852, ratio: 3 },
  { width: 428, height: 926, ratio: 3 },
  { width: 390, height: 844, ratio: 3 },
  { width: 375, height: 812, ratio: 3 },
  { width: 414, height: 896, ratio: 2 },
  { width: 375, height: 667, ratio: 2 },
  { width: 1032, height: 1376, ratio: 2 },
  { width: 834, height: 1210, ratio: 2 },
  { width: 820, height: 1180, ratio: 2 },
];

export interface SplashLink {
  readonly href: string;
  readonly media: string;
}

/** The `<link rel="apple-touch-startup-image">` set, portrait only. */
export function splashLinks(): SplashLink[] {
  return SPLASH_SCREENS.map(({ width, height, ratio }) => ({
    href: `/icons/splash/splash-${width * ratio}x${height * ratio}.png`,
    // `orientation: portrait` is required. Without it iOS matches the first entry whose
    // dimensions fit and shows a landscape device a stretched portrait image.
    media:
      `(device-width: ${width}px) and (device-height: ${height}px) ` +
      `and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
  }));
}
