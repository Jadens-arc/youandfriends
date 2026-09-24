/**
 * Loop regions and speed (task `074`), as pure helpers the controller and the waveform share.
 */
export interface LoopRegionSeconds {
  readonly start: number;
  readonly end: number;
}

/** The shortest loop worth keeping — shorter than a beat is a mis-click, not a loop. */
export const MIN_LOOP_SECONDS = 0.25;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

/** A region inside `[0, duration]` and at least {@link MIN_LOOP_SECONDS} long, or `null`. */
export function normalizeRegion(
  start: number,
  end: number,
  duration: number | null,
): LoopRegionSeconds | null {
  const ceiling = duration ?? Number.POSITIVE_INFINITY;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(ceiling, Math.max(start, end));
  return to - from >= MIN_LOOP_SECONDS ? { start: from, end: to } : null;
}

/** "Set loop in" at the playhead: keep the old end when it is still after, else the track's end. */
export function withIn(
  region: LoopRegionSeconds | null,
  at: number,
  duration: number | null,
): LoopRegionSeconds | null {
  const end = region !== null && region.end > at ? region.end : (duration ?? at + 1);
  return normalizeRegion(at, end, duration);
}

/** "Set loop out" at the playhead: keep the old start when it is still before, else the top. */
export function withOut(
  region: LoopRegionSeconds | null,
  at: number,
  duration: number | null,
): LoopRegionSeconds | null {
  const start = region !== null && region.start < at ? region.start : 0;
  return normalizeRegion(start, at, duration);
}

/**
 * Whether playback has reached the end of the loop and must jump back. Checked every animation
 * frame, not on `timeupdate` (about four times a second — an audibly sloppy loop). A small lead
 * absorbs the frame that would otherwise overshoot.
 */
export function pastLoopEnd(currentTime: number, region: LoopRegionSeconds): boolean {
  return currentTime >= region.end - 0.012 || currentTime < region.start - 0.25;
}

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}
