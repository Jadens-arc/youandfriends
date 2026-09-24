'use client';

import { cn, focusRing, focusRingOnEspresso } from '@youandfriends/ui';
import * as React from 'react';

import { formatClock, spokenPosition } from '@/lib/player/format';
import type { Track } from '@/lib/player/machine';
import { getPlayer, usePlayerState } from '@/lib/player/store';
import { loadWaveform, type DecodedTier } from '@/lib/waveform/decode';

import { LoopRegionOverlay } from './loop-region';

/**
 * The waveform (task `072`, `docs/DESIGN.md` §4 and §11–12).
 *
 * **Canvas**, not DOM or SVG: a bar per pixel as elements is thousands of nodes and a disaster on
 * a phone. **Peaks decoded in a worker**, at the tier this width needs. **The playhead is drawn
 * every frame from the element's own `currentTime`**, never a CSS transition that drifts from the
 * audio. And the whole thing is **a slider** — `role="slider"`, a name, a spoken value, arrow,
 * Page and Home/End keys — because a canvas is invisible to assistive technology, and for some
 * listeners this is the only seek control there is, not a fallback.
 */

export type WaveformVariant = 'large' | 'compact';

/** Seconds the arrow keys move; Page Up/Down move {@link COARSE_STEP_SECONDS}. */
export const FINE_STEP_SECONDS = 5;
export const COARSE_STEP_SECONDS = 30;
const RESIZE_DEBOUNCE_MS = 150;

/** The time under a point `x` pixels into a waveform `width` wide. */
export function timeAtX(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, (x / width) * duration));
}

/** The new position for a key, or `null` for a key the waveform does not handle. */
export function positionForKey(key: string, position: number, duration: number): number | null {
  const clamp = (value: number) => Math.min(duration, Math.max(0, value));
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(position - FINE_STEP_SECONDS);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(position + FINE_STEP_SECONDS);
    case 'PageDown':
      return clamp(position - COARSE_STEP_SECONDS);
    case 'PageUp':
      return clamp(position + COARSE_STEP_SECONDS);
    case 'Home':
      return 0;
    case 'End':
      return duration;
    default:
      return null;
  }
}

export interface WaveformColors {
  readonly played: string;
  readonly unplayed: string;
  readonly playhead: string;
}

/**
 * Draw one tier into a 2D context: one bar per device pixel column, the played part in one colour
 * and the rest in another, and a one-pixel playhead. Pure apart from the context, so it is tested
 * against a recording fake.
 */
export function drawWaveform(
  context: Pick<CanvasRenderingContext2D, 'clearRect' | 'fillRect'> & { fillStyle: unknown },
  tier: DecodedTier,
  options: {
    readonly width: number;
    readonly height: number;
    readonly progress: number;
    readonly colors: WaveformColors;
  },
): void {
  const { width, height, progress, colors } = options;
  context.clearRect(0, 0, width, height);
  const buckets = tier.peaks.length / 2;
  if (buckets === 0 || width <= 0) return;
  const middle = height / 2;
  const playedUntil = Math.round(Math.min(1, Math.max(0, progress)) * width);
  const perColumn = buckets / width;

  for (let x = 0; x < width; x += 1) {
    const from = Math.floor(x * perColumn);
    const to = Math.max(from + 1, Math.floor((x + 1) * perColumn));
    let min = 0;
    let max = 0;
    for (let bucket = from; bucket < to && bucket < buckets; bucket += 1) {
      const low = tier.peaks[bucket * 2] ?? 0;
      const high = tier.peaks[bucket * 2 + 1] ?? 0;
      if (low < min) min = low;
      if (high > max) max = high;
    }
    // At least a hairline, so silence reads as a line rather than a gap.
    const top = middle - (max / 127) * middle;
    const bottom = middle - (min / 127) * middle;
    context.fillStyle = x < playedUntil ? colors.played : colors.unplayed;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
  context.fillStyle = colors.playhead;
  context.fillRect(Math.min(width - 1, playedUntil), 0, 1, height);
}

function readColors(element: HTMLElement, variant: WaveformVariant): WaveformColors {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim() || 'currentColor';
  return variant === 'large'
    ? {
        played: token('--color-primary'),
        unplayed: token('--color-border-strong'),
        playhead: token('--color-rust-text'),
      }
    : {
        played: token('--color-on-espresso'),
        unplayed: token('--color-secondary-on-espresso'),
        playhead: token('--color-on-espresso'),
      };
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly tier: DecodedTier }
  | {
      readonly status: 'unavailable';
      readonly reason: 'not_ready' | 'unauthorized' | 'unavailable' | 'error';
    };

const UNAVAILABLE_TEXT = {
  not_ready: 'The waveform will appear once this version has been processed.',
  unauthorized: 'This waveform is not available to you.',
  unavailable: 'Waveforms are not available right now.',
  error: 'The waveform could not be loaded.',
} as const;

export function Waveform({
  track,
  variant = 'large',
  label,
  className,
}: {
  /** The version this waveform draws, as the player would play it. */
  readonly track: Track;
  readonly variant?: WaveformVariant;
  /** The slider's accessible name, e.g. "Seek in Headlights, version 3". */
  readonly label: string;
  readonly className?: string;
}) {
  const player = usePlayerState();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = React.useState(0);
  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const [hover, setHover] = React.useState<{ x: number; time: number } | null>(null);
  const dragging = React.useRef(false);

  const isLoaded = player.track?.versionId === track.versionId;
  const duration = load.status === 'ready' ? load.tier.frameCount / load.tier.sampleRateHz : null;
  const position = isLoaded ? player.positionSeconds : 0;

  // Width, debounced: redrawing a canvas on every resize frame janks.
  React.useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        const entry = entries[0];
        if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Peaks at the tier this width needs.
  React.useEffect(() => {
    if (width <= 0) return;
    let cancelled = false;
    void loadWaveform(track.versionId, width * (window.devicePixelRatio || 1)).then((result) => {
      if (cancelled) return;
      setLoad(
        result.ok
          ? { status: 'ready', tier: result.tier }
          : { status: 'unavailable', reason: result.reason },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [track.versionId, width]);

  // Draw — every frame while this version plays, once otherwise.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (load.status !== 'ready' || canvas === null || container === null || width <= 0) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const ratio = window.devicePixelRatio || 1;
    const height = container.getBoundingClientRect().height || (variant === 'large' ? 128 : 40);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const colors = readColors(container, variant);
    const total = load.tier.frameCount / load.tier.sampleRateHz;
    const paint = () =>
      drawWaveform(context, load.tier, {
        width: canvas.width,
        height: canvas.height,
        progress: isLoaded ? getPlayer().currentTime() / total : 0,
        colors,
      });
    paint();
    if (!(isLoaded && player.status === 'playing')) return;
    let frame = requestAnimationFrame(function tick() {
      paint();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [load, width, isLoaded, player.status, player.positionSeconds, variant]);

  function seekTo(seconds: number) {
    const controller = getPlayer();
    if (isLoaded) controller.seek(seconds);
    else void controller.load(track, { autoplay: true, startAt: seconds });
  }

  function pointerTime(
    event: React.PointerEvent<HTMLDivElement>,
  ): { x: number; time: number } | null {
    if (duration === null) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(box.width, Math.max(0, event.clientX - box.left));
    return { x, time: timeAtX(x, box.width, duration) };
  }

  if (load.status === 'unavailable') {
    return (
      <p className="text-caption text-muted-foreground px-4 text-center font-sans">
        {UNAVAILABLE_TEXT[load.reason]}
      </p>
    );
  }

  const ready = load.status === 'ready' && duration !== null;
  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={ready ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={duration === null ? 0 : Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={ready ? spokenPosition(position, duration) : 'Loading waveform'}
      aria-disabled={!ready || undefined}
      aria-busy={load.status === 'loading' || undefined}
      data-waveform={variant}
      className={cn(
        'relative h-full w-full cursor-pointer touch-none rounded-sm select-none',
        variant === 'large' ? focusRing : focusRingOnEspresso,
        className,
      )}
      onKeyDown={(event) => {
        if (duration === null) return;
        const next = positionForKey(event.key, position, duration);
        if (next === null) return;
        event.preventDefault();
        seekTo(next);
      }}
      onPointerDown={(event) => {
        const target = pointerTime(event);
        if (target === null) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setHover(target);
      }}
      onPointerMove={(event) => setHover(pointerTime(event))}
      onPointerUp={(event) => {
        const target = pointerTime(event);
        if (dragging.current && target !== null) seekTo(target.time);
        dragging.current = false;
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
    >
      {load.status === 'loading' ? (
        <p className="text-caption text-muted-foreground absolute inset-0 flex items-center justify-center font-sans">
          Loading waveform…
        </p>
      ) : null}
      <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />
      {isLoaded && player.loopRegion !== null && duration !== null ? (
        <LoopRegionOverlay
          region={player.loopRegion}
          duration={duration}
          onChange={(start, end) => getPlayer().setLoopRegion(start, end)}
        />
      ) : null}
      {hover === null ? null : (
        <span
          aria-hidden
          style={{ left: hover.x }}
          className="bg-popover text-caption text-foreground shadow-paper tabular pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full rounded-sm px-1.5 py-0.5 font-mono"
        >
          {formatClock(hover.time)}
        </span>
      )}
    </div>
  );
}
