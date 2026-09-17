import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SPLASH_SCREENS as GENERATOR_SCREENS } from '../../../../../scripts/generate-icons.mjs';
import { splashLinks, SPLASH_SCREENS } from '../splash';

describe('iOS launch images', () => {
  it('lists exactly what the generator renders', () => {
    // Two lists of device sizes is one list too many, and the failure mode is silent: a device
    // added to the generator but not here renders an image nothing links to, and the other way
    // round links to a file that is not there. So they are compared rather than trusted.
    expect(SPLASH_SCREENS).toEqual(GENERATOR_SCREENS);
  });

  it('points at files that exist', () => {
    for (const link of splashLinks()) {
      expect(existsSync(join(process.cwd(), 'public', link.href)), link.href).toBe(true);
    }
  });

  it('constrains every link to portrait', () => {
    // Without `orientation: portrait` iOS matches the first entry whose dimensions fit and
    // stretches a portrait image across a landscape device.
    for (const link of splashLinks()) {
      expect(link.media, link.href).toContain('orientation: portrait');
      expect(link.media, link.href).toContain('-webkit-device-pixel-ratio');
    }
  });

  it('gives every device a distinct media query', () => {
    // Two identical queries mean one image is unreachable, and which one is up to the browser.
    const queries = new Set(splashLinks().map((link) => link.media));
    expect(queries.size).toBe(SPLASH_SCREENS.length);
  });
});
