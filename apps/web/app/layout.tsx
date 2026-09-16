import type { Metadata, Viewport } from 'next';

import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { surface } from '@youandfriends/ui/tokens';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
