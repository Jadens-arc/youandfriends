'use client';

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  Slider,
} from '@youandfriends/ui';
import {
  Keyboard,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import * as React from 'react';

import { CoverArt } from '@/components/library/cover-art';
import type { PlayerState } from '@/lib/player/machine';
import { formatClock, spokenPosition } from '@/lib/player/format';
import { PLAYER_SHORTCUTS } from '@/lib/player/shortcuts';
import { getPlayer, usePlayerState, useQueueState } from '@/lib/player/store';

import { LoopControls } from './loop-controls';
import { describePlayer } from './now-playing';
import { QueuePanel } from './queue-panel';
import { Waveform } from './waveform/waveform';

/**
 * The espresso player bar (task `071`, `docs/DESIGN.md` §4): what is playing, transport, compact
 * progress, volume, and the doors to the queue and the expanded player.
 *
 * Everything here reads the player store and calls the controller; nothing holds its own copy
 * of what is playing. Every control is a real button or slider with a name, every one reachable
 * by keyboard, and every focus ring is the on-espresso treatment (task `012`) — the ink ring is
 * invisible on this bar.
 */

function TrackInfo({
  state,
  size,
}: {
  readonly state: PlayerState;
  readonly size: 'bar' | 'large';
}) {
  const track = state.track;
  if (track === null) {
    return <p className="text-caption text-secondary-on-espresso font-sans">Nothing playing</p>;
  }
  const byline = track.artist ?? '';
  return (
    <div className={cn('flex min-w-0 items-center gap-3', size === 'large' && 'flex-col')}>
      <div className={size === 'bar' ? 'w-10 shrink-0' : 'w-64 max-w-full'}>
        <CoverArt
          id={track.songId}
          name={track.title}
          cover={track.cover ?? null}
          sizes={size === 'bar' ? '40px' : '256px'}
        />
      </div>
      <div className={cn('min-w-0', size === 'large' && 'text-center')}>
        {/* Truncated on screen; `title` shows the whole of it on hover, and the text itself is
            whole in the DOM, so assistive technology reads all of it. */}
        <p
          className={cn(
            'text-on-espresso truncate font-sans font-medium',
            size === 'bar' ? 'text-body' : 'text-heading font-serif',
          )}
          title={track.title}
        >
          {track.title}
        </p>
        <p className="text-caption text-secondary-on-espresso truncate font-sans" title={byline}>
          {byline === '' ? null : <span>{byline} · </span>}
          {/* The version is a word, not a colour: A/B switching (task `075`) changes it. */}
          <span className="border-on-espresso/30 text-on-espresso rounded-sm border px-1 font-medium">
            {track.versionLabel}
          </span>
        </p>
      </div>
    </div>
  );
}

function Transport({
  state,
  large = false,
}: {
  readonly state: PlayerState;
  readonly large?: boolean;
}) {
  const player = getPlayer();
  const hasTrack = state.track !== null;
  const playing = state.wantsToPlay;
  const busy = state.status === 'loading' || state.status === 'stalled';
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="onEspresso"
        size="icon"
        className="size-11"
        aria-label="Previous"
        disabled={!hasTrack}
        onClick={() => player.previous()}
      >
        <SkipBack aria-hidden />
      </Button>
      <Button
        variant="onEspresso"
        size="icon"
        className={cn('bg-on-espresso/10 shadow-inset', large ? 'size-14' : 'size-11')}
        aria-label={playing ? 'Pause' : 'Play'}
        aria-busy={busy || undefined}
        disabled={!hasTrack}
        onClick={() => player.toggle()}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <Button
        variant="onEspresso"
        size="icon"
        className="size-11"
        aria-label="Next"
        disabled={!player.hasNext()}
        onClick={() => player.next()}
      >
        <SkipForward aria-hidden />
      </Button>
    </div>
  );
}

function Progress({ state }: { readonly state: PlayerState }) {
  const player = getPlayer();
  const duration = state.durationSeconds;
  const position = Math.min(state.positionSeconds, duration ?? state.positionSeconds);
  const remaining = duration === null ? null : Math.max(0, duration - position);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="text-caption text-secondary-on-espresso tabular w-12 shrink-0 text-right font-mono">
        {formatClock(position)}
      </span>
      <Slider
        tone="espresso"
        thumbLabel="Seek"
        valueText={spokenPosition(position, duration)}
        min={0}
        max={duration ?? 1}
        step={1}
        value={[position]}
        disabled={state.track === null || duration === null}
        onValueChange={([value]) => {
          if (value !== undefined) player.seek(value);
        }}
      />
      <span className="text-caption text-secondary-on-espresso tabular w-12 shrink-0 font-mono">
        {remaining === null ? '–:––' : `-${formatClock(remaining)}`}
      </span>
    </div>
  );
}

function Volume({ state }: { readonly state: PlayerState }) {
  const player = getPlayer();
  const silent = state.muted || state.volume === 0;
  return (
    <div className="flex w-36 shrink-0 items-center gap-1">
      <Button
        variant="onEspresso"
        size="icon"
        className="size-11"
        aria-label={state.muted ? 'Unmute' : 'Mute'}
        aria-pressed={state.muted}
        onClick={() => player.toggleMute()}
      >
        {silent ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      </Button>
      <Slider
        tone="espresso"
        thumbLabel="Volume"
        valueText={state.muted ? 'Muted' : `${Math.round(state.volume * 100)} percent`}
        min={0}
        max={100}
        step={5}
        value={[state.muted ? 0 : Math.round(state.volume * 100)]}
        onValueChange={([value]) => {
          if (value !== undefined) player.setVolume(value / 100);
        }}
      />
    </div>
  );
}

function Shortcuts() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="onEspresso"
          size="icon"
          className="size-11"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Anywhere in the workspace, except while typing in a field or the lyrics editor.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-sans">
          {PLAYER_SHORTCUTS.map((shortcut) => (
            <React.Fragment key={shortcut.keys}>
              <dt className="text-body text-foreground font-mono">{shortcut.keys}</dt>
              <dd className="text-body text-muted-foreground">{shortcut.action}</dd>
            </React.Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** The large view: cover, title, transport and progress, over the page. */
export function ExpandedPlayer({ state }: { readonly state: PlayerState }) {
  const { detail } = describePlayer(state);
  return (
    <div className="on-espresso bg-espresso text-on-espresso flex flex-col items-center gap-6 rounded-lg p-6">
      <TrackInfo state={state} size="large" />
      <p className="text-caption text-secondary-on-espresso font-sans" aria-live="polite">
        {detail}
      </p>
      <div className="flex w-full max-w-xl flex-col items-center gap-4">
        {state.track === null ? null : (
          <div className="h-12 w-full">
            <Waveform
              track={state.track}
              variant="compact"
              label={`Seek in ${state.track.title}, ${state.track.versionLabel}`}
            />
          </div>
        )}
        <Progress state={state} />
        <Transport state={state} large />
        <LoopControls tone="espresso" />
      </div>
    </div>
  );
}

export function PlayerBar() {
  const state = usePlayerState();
  const [expanded, setExpanded] = React.useState(false);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const queue = useQueueState();
  const { detail } = describePlayer(state);
  return (
    <div className="flex w-full min-w-0 items-center gap-4">
      <div className="flex w-64 min-w-0 shrink-0 flex-col">
        <TrackInfo state={state} size="bar" />
        {/* Status in words — loading, buffering, an error — never only an icon or a colour. */}
        <p className="sr-only" aria-live="polite">
          {detail}
        </p>
      </div>
      <Transport state={state} />
      <Progress state={state} />
      <Volume state={state} />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="onEspresso"
          size="icon"
          className="size-11"
          aria-label={
            queue.items.length === 0
              ? 'Queue — nothing queued'
              : `Queue — ${queue.items.length} ${queue.items.length === 1 ? 'track' : 'tracks'}`
          }
          aria-expanded={queueOpen}
          disabled={queue.items.length === 0}
          onClick={() => setQueueOpen(true)}
        >
          <ListMusic aria-hidden />
        </Button>
        <Button
          variant="onEspresso"
          size="icon"
          className="size-11"
          aria-label="Expand player"
          aria-expanded={expanded}
          disabled={state.track === null}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 aria-hidden />
        </Button>
        <Shortcuts />
      </div>
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} />
      <Sheet open={expanded} onOpenChange={setExpanded}>
        <SheetContent side="bottom" className="bg-espresso border-border-on-espresso">
          <SheetTitle className="sr-only">Player</SheetTitle>
          <ExpandedPlayer state={state} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { formatClock, spokenPosition };
