'use client';

import { Button, cn } from '@youandfriends/ui';
import { Repeat, Scissors, X } from 'lucide-react';

import { formatClock } from '@/lib/player/format';
import { SPEEDS } from '@/lib/player/loop';
import { getPlayer, usePlayerState } from '@/lib/player/store';

/**
 * Loop and speed (task `074`): loop the track, loop a region set from the playhead (the fast
 * path in practice — I and O on the keyboard), clear it, and change speed. Every state is said in
 * words; the region is also drawn on the waveform.
 */
export function LoopControls({
  tone = 'paper',
  songId,
}: {
  readonly tone?: 'paper' | 'espresso';
  /** On a song's page: shown only while that song is the one loaded, so they never act on another. */
  readonly songId?: string;
}) {
  const state = usePlayerState();
  if (songId !== undefined && state.track?.songId !== songId) return null;
  const player = getPlayer();
  const disabled = state.track === null;
  const variant = tone === 'espresso' ? 'onEspresso' : 'secondary';
  const region = state.loopRegion;
  const muted = tone === 'espresso' ? 'text-secondary-on-espresso' : 'text-muted-foreground';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={variant}
        size="sm"
        aria-pressed={state.loopTrack}
        disabled={disabled}
        onClick={() => player.toggleLoopTrack()}
      >
        <Repeat aria-hidden />
        {state.loopTrack ? 'Looping track' : 'Loop track'}
      </Button>
      <Button variant={variant} size="sm" disabled={disabled} onClick={() => player.setLoopIn()}>
        <Scissors aria-hidden />
        Loop from here
      </Button>
      <Button variant={variant} size="sm" disabled={disabled} onClick={() => player.setLoopOut()}>
        Loop to here
      </Button>
      <Button
        variant={variant}
        size="sm"
        disabled={region === null}
        onClick={() => player.clearLoopRegion()}
      >
        <X aria-hidden />
        Clear loop
      </Button>
      <p className={cn('text-caption tabular font-sans', muted)} aria-live="polite">
        {region === null
          ? 'No loop region'
          : `Looping ${formatClock(region.start)}–${formatClock(region.end)}`}
      </p>
      <label className={cn('text-caption flex items-center gap-2 font-sans', muted)}>
        Speed
        <select
          className="border-border bg-card text-foreground rounded-sm border px-1 py-0.5"
          value={String(state.rate)}
          disabled={disabled}
          onChange={(event) => player.setRate(Number(event.target.value))}
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={String(speed)}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      {state.rate !== 1 && !player.preservesPitch() ? (
        <p className={cn('text-caption font-sans', muted)}>
          This browser changes pitch with speed.
        </p>
      ) : null}
    </div>
  );
}
