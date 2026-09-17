#!/usr/bin/env node
/**
 * Rasterise the app icons from `mark.svg`.
 *
 * Generated, not hand-maintained: there are a dozen sizes plus the iOS splash screens, and a
 * set kept by hand drifts the moment one of them is regenerated and the others are not
 * (task `100`). The sources are two SVGs carrying the real Newsreader Italic ampersand as a
 * path, so nothing here depends on a font being installed.
 *
 * `pnpm icons` after changing either source. The output is committed, because a build that
 * fetches or rasterises fonts is a build that fails differently on somebody else's machine.
 */
/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'apps/web/public/icons');

/**
 * The sizes, and who asks for each.
 *
 * 192 and 512 are the manifest's required pair. 180 is what iOS uses for `apple-touch-icon`
 * and it must be square with no transparency — iOS composites onto white otherwise, and the
 * espresso ground is the point.
 */
export const ICON_SIZES = [16, 32, 48, 96, 144, 180, 192, 256, 384, 512, 1024];

/** Android crops a maskable icon to a circle or squircle; these carry the smaller glyph. */
export const MASKABLE_SIZES = [192, 512];

/**
 * iOS launch images, in device pixels.
 *
 * iOS ignores the manifest's `background_color` and shows a white flash unless it finds an
 * `apple-touch-startup-image` whose media query matches the device exactly — which is why this
 * is a list of resolutions rather than one scalable asset. Generated, never hand-maintained:
 * there are a dozen, and a set kept by hand goes stale on the next device Apple ships.
 *
 * `width`/`height` are CSS pixels and `ratio` the device pixel ratio, because that is what the
 * media query matches on; the rendered file is width×ratio by height×ratio.
 */
export const SPLASH_SCREENS = [
  { width: 440, height: 956, ratio: 3 }, // iPhone 16 Pro Max, 15 Pro Max
  { width: 402, height: 874, ratio: 3 }, // iPhone 16 Pro
  { width: 430, height: 932, ratio: 3 }, // iPhone 15 Pro Max, 14 Pro Max
  { width: 393, height: 852, ratio: 3 }, // iPhone 15 Pro, 14 Pro
  { width: 428, height: 926, ratio: 3 }, // iPhone 13 Pro Max, 12 Pro Max
  { width: 390, height: 844, ratio: 3 }, // iPhone 13, 12
  { width: 375, height: 812, ratio: 3 }, // iPhone 13 mini, X, XS, 11 Pro
  { width: 414, height: 896, ratio: 2 }, // iPhone 11, XR
  { width: 375, height: 667, ratio: 2 }, // iPhone SE
  { width: 1032, height: 1376, ratio: 2 }, // iPad Pro 13"
  { width: 834, height: 1210, ratio: 2 }, // iPad Air 11"
  { width: 820, height: 1180, ratio: 2 }, // iPad 10th gen
];

async function render(source, size, out) {
  const png = await sharp(join(ICONS, source), { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(ICONS, out), png);
  return png.length;
}

await mkdir(ICONS, { recursive: true });

let total = 0;
for (const size of ICON_SIZES) {
  total += await render('mark.svg', size, `icon-${size}.png`);
}
for (const size of MASKABLE_SIZES) {
  total += await render('mark-maskable.svg', size, `icon-maskable-${size}.png`);
}

// The favicon browsers request from the root without being told to.
await writeFile(
  join(ROOT, 'apps/web/app/icon.png'),
  await sharp(join(ICONS, 'mark.svg'), { density: 384 }).resize(32, 32).png().toBuffer(),
);
await writeFile(
  join(ROOT, 'apps/web/app/apple-icon.png'),
  await sharp(join(ICONS, 'mark.svg'), { density: 384 }).resize(180, 180).png().toBuffer(),
);

/**
 * A launch image: the mark centred on the cream page ground.
 *
 * The ground is `surface.canvas`, not the espresso of the icon, because this is the moment
 * before the page paints and it should be the page's colour — a dark flash resolving to cream
 * is the jarring version of the same transition.
 */
const SPLASH_DIR = join(ICONS, 'splash');
await mkdir(SPLASH_DIR, { recursive: true });

const markFor = (size) =>
  sharp(join(ICONS, 'mark.svg'), { density: 384 }).resize(size, size).composite([]).toBuffer();

for (const { width, height, ratio } of SPLASH_SCREENS) {
  const w = width * ratio;
  const h = height * ratio;
  // A quarter of the short edge, which keeps the mark comfortable on both a phone and an iPad.
  const markSize = Math.round(Math.min(w, h) * 0.25);
  const mark = await markFor(markSize);

  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: '#F3EEE3' },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(join(SPLASH_DIR, `splash-${w}x${h}.png`), png);
  total += png.length;
}

console.log(
  `Rendered ${ICON_SIZES.length + MASKABLE_SIZES.length} icons, ${SPLASH_SCREENS.length} ` +
    `launch images, icon.png and apple-icon.png — ${(total / 1024).toFixed(0)} KB.`,
);
