import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';

import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { surface } from '@youandfriends/ui/tokens';

import { clerkAppearance } from '@/lib/auth/appearance';

import { fontVariables } from './fonts';

import './globals.css';

export const metadata: Metadata = {
  // React escapes the ampersand on render; the raw name is correct here.
  title: PRODUCT_NAME,
  description: `${PRODUCT_TAGLINE} A private music workspace ${PRODUCT_ATTRIBUTION}.`,
  metadataBase: new URL('https://youandfriends.org'),
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
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
