'use client';

import { cn } from '@youandfriends/ui';
import * as React from 'react';

import { NowPlaying } from '@/components/player/now-playing';

/** Reserved height of the player bar. Also used to pad scroll containers above it. */
export const PLAYER_HEIGHT = '4.5rem';

/**
 * The persistent player region.
 *
 * **This is the structural reason playback survives navigation.** It is rendered by the
 * workspace layout, above the route segment, so Next.js never unmounts it when the route
 * changes. Placing it inside a page would restart audio on every navigation — the one thing
 * `docs/DESIGN.md` §1 says must never happen.
 *
 * The height is reserved whether or not anything is playing, so the first play does not
 * shove the page upward.
 *
 * Transport controls, the waveform, and audio itself arrive in tasks `070`–`072`. This is
 * the slot and the guarantee, not the player.
 */
export function PlayerRegion({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-player-region
      style={{ height: PLAYER_HEIGHT }}
      className={cn(
        'on-espresso border-border-on-espresso flex shrink-0 items-center gap-4 border-t',
        'bg-espresso text-on-espresso px-4',
      )}
    >
      {children ?? <NowPlaying className="min-w-0 flex-1" />}
    </div>
  );
}
