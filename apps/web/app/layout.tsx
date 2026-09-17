import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';

import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { surface } from '@youandfriends/ui/tokens';

import { ServiceWorker } from '@/components/pwa/service-worker';
import { splashLinks } from '@/lib/pwa/splash';
import { clerkAppearance } from '@/lib/auth/appearance';

import { fontVariables } from './fonts';

import './globals.css';

export const metadata: Metadata = {
  // React escapes the ampersand on render; the raw name is correct here.
  title: PRODUCT_NAME,
  description: `${PRODUCT_TAGLINE} A private music workspace ${PRODUCT_ATTRIBUTION}.`,
  metadataBase: new URL('https://youandfriends.org'),
  // iOS ignores most of the manifest and reads these instead. Without them the Home Screen
  // icon falls back to a screenshot of the page and launching it opens Safari chrome rather
  // than the app (task `100`).
  appleWebApp: {
    capable: true,
    title: PRODUCT_NAME,
    // `default` keeps the status bar legible on the espresso rail. `black-translucent` puts
    // the page under the status bar, which on a notched device overlaps the header.
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: surface.espresso,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * `ClerkProvider` wraps the whole tree, including the sign-in surfaces themselves — Clerk's
 * components need its context to render, so putting it only around the workspace would leave
 * the front door unable to open.
 *
 * `dynamic` is deliberately not set: the provider reads the session per request anyway, and
 * forcing dynamic rendering here would opt every static page out of prerendering for nothing.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" className={fontVariables}>
        <head>
          {/*
            iOS launch images. Next's Metadata API has no field for these, so they are emitted
            directly — and generated from the same list the images are rendered from, because a
            hand-maintained set goes stale on the next device Apple ships.
          */}
          {splashLinks().map((link) => (
            <link
              key={link.href}
              rel="apple-touch-startup-image"
              href={link.href}
              media={link.media}
            />
          ))}
        </head>
        <body>
          {children}
          <ServiceWorker />
        </body>
      </html>
    </ClerkProvider>
  );
}
