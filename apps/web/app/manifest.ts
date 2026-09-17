import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { surface } from '@youandfriends/ui/tokens';
import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * A typed route rather than the static file in `public/` the task named: the `Manifest` type
 * catches a misspelled `display` or a malformed icon entry at build time, and a manifest is
 * exactly the kind of file whose mistakes surface as "the install button never appeared" on
 * somebody else's phone.
 *
 * **The name carries the ampersand as a plain character.** This is JSON, not HTML — `&amp;`
 * here would put the literal five characters on the Home Screen (`docs/DESIGN.md` §16).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    // 12 characters is roughly what iOS shows under a Home Screen icon before it truncates.
    short_name: PRODUCT_NAME,
    description: PRODUCT_TAGLINE,
    start_url: '/',
    // `standalone`, not `fullscreen`: the workspace is a tool, and taking the status bar away
    // costs the clock and the battery indicator for nothing.
    display: 'standalone',
    orientation: 'portrait-primary',
    // The cream page ground, so the splash matches what loads rather than flashing white.
    background_color: surface.canvas,
    // The espresso rail, which is what sits behind the status bar in standalone.
    theme_color: surface.espresso,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops these to a circle or squircle. They carry the glyph at 40% rather than
      // 58% so the crop never takes its shoulders off.
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
