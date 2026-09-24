'use client';

import { BottomSheetContent, Button, cn, Sheet, SheetTitle, transition } from '@youandfriends/ui';
import { ChevronUp, Pause, Play } from 'lucide-react';
import * as React from 'react';

import { CoverArt } from '@/components/library/cover-art';
import { MobileExpandedPlayer } from '@/components/player/mobile/expanded-player';
import { NowPlaying } from '@/components/player/now-playing';
import { QueuePanel } from '@/components/player/queue-panel';
import { getPlayer, usePlayerState } from '@/lib/player/store';

/**
 * Height of the mini-player.
 *
 * The player is a flow sibling of the scroll container rather than an overlay, so nothing
 * scrolls underneath it and nothing is hidden behind it: it takes its own space above the bottom
 * navigation, and the page ends where it begins.
 */
export const MINI_PLAYER_HEIGHT = '3.5rem';

/** How far up a swipe on the mini-player must travel to count as "expand". */
export const EXPAND_SWIPE_PX = 32;

/**
 * Mini-player (`docs/DESIGN.md` §10, task `077`).
 *
 * Artwork, title and play/pause, docked above the bottom navigation. Tapping the artwork and title
 * — or swiping up on them — opens the full-screen player; so does the chevron button, the path for
 * keyboard and assistive technology. The swipe is bound to that strip only, never the whole
 * screen: a page-wide vertical gesture would fight scrolling, and one near the edge would fight
 * iOS Safari's back-swipe. Swipe-down on the expanded player's header closes it (the bottom
 * sheet's own drag), as do its close button and Escape.
 */
export function MiniPlayer() {
  const [expanded, setExpanded] = React.useState(false);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const state = usePlayerState();
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const hasTrack = state.track !== null;

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
        <button
          type="button"
          data-expand-strip
          aria-label={hasTrack ? `Open player: ${state.track?.title}` : 'Open player'}
          onClick={() => setExpanded(true)}
          onPointerDown={(event) => {
            start.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const from = start.current;
            start.current = null;
            if (from === null) return;
            const dy = event.clientY - from.y;
            const dx = event.clientX - from.x;
            if (dy < -EXPAND_SWIPE_PX && Math.abs(dy) > Math.abs(dx)) setExpanded(true);
          }}
          // A vertical drag here is the expand gesture, not a page scroll.
          className="flex min-h-11 min-w-0 flex-1 touch-none items-center gap-3 rounded-sm text-left"
        >
          <span className="w-9 shrink-0" aria-hidden>
            {state.track === null ? (
              <span className="bg-on-espresso/10 block size-9 rounded-sm" />
            ) : (
              <CoverArt
                id={state.track.songId}
                name={state.track.title}
                cover={state.track.cover ?? null}
                sizes="36px"
              />
            )}
          </span>
          <NowPlaying className="min-w-0 flex-1" />
        </button>

        <Button
          variant="onEspresso"
          size="icon"
          aria-label={state.wantsToPlay ? 'Pause' : 'Play'}
          disabled={!hasTrack}
          onClick={() => getPlayer().toggle()}
          className={cn('size-11 shrink-0', transition)}
        >
          {state.wantsToPlay ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
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
        <BottomSheetContent className="bg-espresso border-border-on-espresso flex h-[100dvh] flex-col">
          <SheetTitle className="text-on-espresso">Player</SheetTitle>
          <MobileExpandedPlayer
            onOpenQueue={() => {
              setQueueOpen(true);
            }}
          />
        </BottomSheetContent>
      </Sheet>
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} />
    </>
  );
}
