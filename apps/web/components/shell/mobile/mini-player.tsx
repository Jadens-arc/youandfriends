'use client';

import { BottomSheetContent, Button, cn, Sheet, SheetTitle, transition } from '@youandfriends/ui';
import { ChevronUp, Play } from 'lucide-react';
import * as React from 'react';

import { NowPlaying } from '@/components/player/now-playing';

/**
 * Height of the mini-player.
 *
 * The player is a flow sibling of the scroll container rather than an overlay, so nothing
 * needs padding to clear it — the last list item cannot slide underneath something that was
 * never on top of it. The value is exported for surfaces that *do* overlay, and for the
 * tests that assert the reservation.
 */
export const MINI_PLAYER_HEIGHT = '3.5rem';

/**
 * Mini-player (docs/DESIGN.md §10).
 *
 * Sits directly above the bottom navigation and expands to a full-screen player. Audio and
 * transport arrive in tasks `070`–`077`; this is the surface and its expand affordance.
 *
 * The expand control is a button rather than a swipe-only gesture. A swipe on the whole
 * surface would fight iOS Safari's edge-swipe back gesture, and a gesture with no button
 * equivalent is unreachable by keyboard and screen reader.
 */
export function MiniPlayer() {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <>
      <div
        data-mini-player
        style={{ height: MINI_PLAYER_HEIGHT }}
        className={cn(
          'on-espresso border-border-on-espresso flex shrink-0 items-center gap-3 border-t',
          'bg-espresso text-on-espresso px-3',
        )}
      >
        <div className="bg-on-espresso/10 size-9 shrink-0 rounded-sm" aria-hidden />

        <NowPlaying className="min-w-0 flex-1" />

        <Button
          variant="onEspresso"
          size="icon"
          aria-label="Play"
          disabled
          className={cn('size-11 shrink-0', transition)}
        >
          <Play className="size-4" aria-hidden />
        </Button>

        <Button
          variant="onEspresso"
          size="icon"
          aria-label="Expand player"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
          className="size-11 shrink-0"
        >
          <ChevronUp className="size-4" aria-hidden />
        </Button>
      </div>

      <Sheet open={expanded} onOpenChange={setExpanded}>
        {/* `dvh`, not `vh`: on iOS Safari the viewport shrinks as the URL bar collapses and
            `vh` leaves the bottom of the player under the browser chrome. */}
        <BottomSheetContent className="h-[100dvh]">
          <SheetTitle>Player</SheetTitle>
          <p className="text-body text-muted-foreground font-sans">
            The expanded player — waveform, queue, loop, speed, and version switching — arrives in
            task 077.
          </p>
        </BottomSheetContent>
      </Sheet>
    </>
  );
}
