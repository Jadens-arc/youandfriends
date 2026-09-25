'use client';

import { cn, focusRing } from '@youandfriends/ui';
import * as React from 'react';

import { spokenPosition } from '@/lib/player/format';
import type { LoopRegionSeconds } from '@/lib/player/loop';

/** How far a handle moves per arrow key; Shift moves {@link HANDLE_FINE_SECONDS}. */
export const HANDLE_STEP_SECONDS = 0.5;
export const HANDLE_FINE_SECONDS = 0.1;

/**
 * The active loop region on the waveform (task `074`): a translucent band — the audio's shape
 * stays readable through it — with a handle at each end. The handles are sliders in their own
 * right, named "Loop start" and "Loop end", draggable and movable by arrow keys, so a loop can be
 * set precisely without a pointer.
 */
export function LoopRegionOverlay({
  region,
  duration,
  onChange,
}: {
  readonly region: LoopRegionSeconds;
  readonly duration: number;
  readonly onChange: (start: number, end: number) => void;
}) {
  const left = (region.start / duration) * 100;
  const width = ((region.end - region.start) / duration) * 100;
  return (
    <>
      <div
        aria-hidden
        data-loop-region
        style={{ left: `${left}%`, width: `${width}%` }}
        className="bg-ochre/20 border-ochre-text/60 pointer-events-none absolute inset-y-0 border-x-2"
      />
      <Handle
        edge="start"
        value={region.start}
        duration={duration}
        onMove={(value) => onChange(value, region.end)}
      />
      <Handle
        edge="end"
        value={region.end}
        duration={duration}
        onMove={(value) => onChange(region.start, value)}
      />
    </>
  );
}

function Handle({
  edge,
  value,
  duration,
  onMove,
}: {
  readonly edge: 'start' | 'end';
  readonly value: number;
  readonly duration: number;
  readonly onMove: (value: number) => void;
}) {
  const dragging = React.useRef(false);
  const label = edge === 'start' ? 'Loop start' : 'Loop end';
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={spokenPosition(value, null)}
      style={{ left: `${(value / duration) * 100}%` }}
      className={cn(
        'bg-ochre-text absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm',
        focusRing,
      )}
      onKeyDown={(event) => {
        const step = event.shiftKey ? HANDLE_FINE_SECONDS : HANDLE_STEP_SECONDS;
        const delta =
          event.key === 'ArrowLeft' || event.key === 'ArrowDown'
            ? -step
            : event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? step
              : 0;
        if (delta === 0) return;
        // The waveform underneath is a slider too; this key is the handle's alone.
        event.preventDefault();
        event.stopPropagation();
        onMove(Math.min(duration, Math.max(0, value + delta)));
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        const track = event.currentTarget.parentElement?.getBoundingClientRect();
        if (track === undefined || track.width <= 0) return;
        const x = Math.min(track.width, Math.max(0, event.clientX - track.left));
        onMove((x / track.width) * duration);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        dragging.current = false;
      }}
    />
  );
}
