import type { Metadata } from 'next';

import { PRODUCT_NAME } from '@youandfriends/config';

export const metadata: Metadata = { title: `Offline · ${PRODUCT_NAME}` };

/**
 * What a navigation falls back to with no network.
 *
 * Deliberately says nothing about the workspace. This page is precached and therefore identical
 * for everyone — a shared device shows it to whoever opens the app next, so it must contain no
 * hint of who was here or what they were working on.
 *
 * It also does not promise offline playback. Offline content is task `203`, and telling someone
 * their music is available when it is not is the kind of claim `CLAUDE.md` §12 rules out.
 */
export default function OfflinePage() {
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-foreground text-2xl tracking-tight">No connection</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        {PRODUCT_NAME} needs the network to reach your workspace. This page is the only part that
        works offline — your music is still where you left it.
      </p>
    </main>
  );
}
