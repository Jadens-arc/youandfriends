'use client';

import { Button } from '@youandfriends/ui';
import { ListMusic } from 'lucide-react';

import { LoopControls } from '@/components/player/loop-controls';
import { describePlayer } from '@/components/player/now-playing';
import { Progress, Shortcuts, TrackInfo, Transport, Volume } from '@/components/player/player-bar';
import { VersionPicker } from '@/components/player/version-picker';
import { Waveform } from '@/components/player/waveform/waveform';
import { usePlayerState, useQueueState } from '@/lib/player/store';

/**
 * The phone's full-screen player (task `077`): everything the desktop bar and its expanded view
 * offer — transport, waveform, progress, loop, speed, version switching, volume, queue, the
 * shortcut list — at 44 px targets. The phone is a working surface, not a viewer
 * (`docs/DESIGN.md` §1); nothing is dropped for being small.
 */
export function MobileExpandedPlayer({ onOpenQueue }: { readonly onOpenQueue: () => void }) {
  const state = usePlayerState();
  const queue = useQueueState();
  const { detail } = describePlayer(state);
  return (
    <div className="on-espresso bg-espresso text-on-espresso -mx-6 -mb-6 flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <TrackInfo state={state} size="large" />
      <p className="text-caption text-secondary-on-espresso font-sans" aria-live="polite">
        {detail}
      </p>
      {state.track === null ? null : (
        // The waveform picks its peak tier from this narrower width by itself (task `072`).
        <div className="h-14 w-full">
          <Waveform
            track={state.track}
            variant="compact"
            label={`Seek in ${state.track.title}, ${state.track.versionLabel}`}
          />
        </div>
      )}
      <Progress state={state} />
      <Transport state={state} large />
      <VersionPicker />
      <LoopControls tone="espresso" touch />
      <div className="flex w-full items-center justify-between gap-2">
        <Volume state={state} />
        <div className="flex items-center gap-1">
          <Button
            variant="onEspresso"
            size="icon"
            className="size-11"
            aria-label={
              queue.items.length === 0
                ? 'Queue — nothing queued'
                : `Queue — ${queue.items.length} ${queue.items.length === 1 ? 'track' : 'tracks'}`
            }
            disabled={queue.items.length === 0}
            onClick={onOpenQueue}
          >
            <ListMusic aria-hidden />
          </Button>
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}
