'use client';

import {
  Button,
  cn,
  focusRing,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  transition,
} from '@youandfriends/ui';
import { ArrowDown, ArrowUp, GripVertical, Play, Repeat, Repeat1, Shuffle, X } from 'lucide-react';
import * as React from 'react';

import type { RepeatMode } from '@/lib/player/queue';
import { getPlayer, usePlayerState, useQueueState } from '@/lib/player/store';

/**
 * The queue panel (task `073`): what is playing, what comes next, and the controls to change it.
 *
 * Reordering is by drag **and** by the Move up / Move down buttons on every row — the keyboard
 * path is not a fallback hidden behind a mode, it is always there (the same rule as task `040`'s
 * folder tree). Every row names itself ("Headlights, Version 3, 2 of 9"), and the current track
 * says "Now playing" in words.
 */

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: 'Repeat: off',
  all: 'Repeat: all',
  one: 'Repeat: this track',
};

export function QueuePanel({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const queue = useQueueState();
  const player = usePlayerState();
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const controller = getPlayer();
  const rows = queue.order.map((itemIndex, position) => ({
    position,
    track: queue.items[itemIndex],
  }));

  function moveTo(from: number, to: number) {
    const track = rows[from]?.track;
    controller.moveInQueue(from, to);
    if (track !== undefined) {
      setAnnouncement(`${track.title} moved to position ${to + 1} of ${rows.length}.`);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 sm:max-w-md">
        <div className="flex flex-col gap-1">
          <SheetTitle>Queue</SheetTitle>
          <SheetDescription>
            {rows.length === 0
              ? 'Nothing queued.'
              : `${rows.length} ${rows.length === 1 ? 'track' : 'tracks'}.`}
          </SheetDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={queue.shuffle}
            onClick={() => controller.toggleShuffle()}
          >
            <Shuffle aria-hidden />
            {queue.shuffle ? 'Shuffle: on' : 'Shuffle: off'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={queue.repeat !== 'off'}
            onClick={() => controller.cycleRepeat()}
          >
            {queue.repeat === 'one' ? <Repeat1 aria-hidden /> : <Repeat aria-hidden />}
            {REPEAT_LABEL[queue.repeat]}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rows.length <= 1}
            onClick={() => controller.clearQueue()}
          >
            Clear upcoming
          </Button>
        </div>

        <ol aria-label="Queue" className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          {rows.map(({ position, track }) => {
            if (track === undefined) return null;
            const current = position === queue.position;
            const name = `${track.title}, ${track.versionLabel}, ${position + 1} of ${rows.length}`;
            return (
              <li
                key={`${track.versionId}-${position}`}
                draggable
                onDragStart={() => setDragFrom(position)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) moveTo(dragFrom, position);
                  setDragFrom(null);
                }}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'border-border-subtle flex items-center gap-2 rounded-md border px-2 py-1.5',
                  current ? 'bg-card shadow-paper border-primary' : 'border-transparent',
                )}
              >
                <GripVertical aria-hidden className="text-muted-foreground size-4 shrink-0" />
                <button
                  type="button"
                  aria-label={`Play ${name}`}
                  onClick={() => void controller.playFromQueue(position)}
                  className={cn(
                    'flex min-w-0 flex-1 flex-col rounded-sm text-left',
                    transition,
                    focusRing,
                  )}
                >
                  <span
                    className="text-body text-foreground truncate font-sans"
                    title={track.title}
                  >
                    {track.title}
                  </span>
                  <span className="text-caption text-muted-foreground truncate font-sans">
                    {track.versionLabel}
                    {current ? ` · ${player.wantsToPlay ? 'Now playing' : 'Current'}` : null}
                  </span>
                </button>
                {current ? <Play aria-hidden className="text-primary size-4 shrink-0" /> : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  aria-label={`Move up: ${name}`}
                  disabled={position === 0}
                  onClick={() => moveTo(position, position - 1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  aria-label={`Move down: ${name}`}
                  disabled={position === rows.length - 1}
                  onClick={() => moveTo(position, position + 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  aria-label={`Remove: ${name}`}
                  onClick={() => {
                    controller.removeFromQueue(position);
                    setAnnouncement(`${track.title} removed from the queue.`);
                  }}
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </SheetContent>
    </Sheet>
  );
}
