'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronDown, ChevronUp } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';
import { SheetContent, type SheetContentProps } from './sheet';

/** Drag distance past which release dismisses rather than settles back. */
const DISMISS_DISTANCE = 96;

/** Downward speed (px/ms) that dismisses regardless of distance — a flick, not a haul. */
const DISMISS_VELOCITY = 0.5;

/** Resistance applied to upward drag, so the sheet resists rather than refuses. */
const UPWARD_RESISTANCE = 4;

/**
 * The heights a sheet settles at (task `103`). A sheet snaps between them, never floats: free
 * positioning feels imprecise under a thumb. `full` stops short of the top so the page behind
 * still shows it is a sheet, and clears the notch.
 */
export type SheetSnap = 'peek' | 'half' | 'full';

const SNAP_HEIGHTS: Readonly<Record<SheetSnap, string>> = {
  peek: '40dvh',
  half: '62dvh',
  full: 'calc(100dvh - 2.5rem - env(safe-area-inset-top))',
};

export type BottomSheetContentProps = Omit<SheetContentProps, 'side' | 'dragHandleProps'> & {
  /**
   * Heights this sheet snaps between, smallest first. Absent, the sheet is as tall as its
   * content. With more than one, dragging up grows it, dragging down shrinks it and then
   * dismisses, and a visible button does the same from a keyboard.
   */
  readonly snapPoints?: readonly SheetSnap[];
};

/**
 * Bottom sheet with drag-to-dismiss (docs/DESIGN.md §10).
 *
 * Drag is bound to the header strip rather than the whole surface. Binding the surface would
 * make every scrollable sheet ambiguous on the first pixel of movement — the gesture that
 * scrolls a comment thread is the gesture that dismisses it — and iOS resolves that the same
 * way.
 *
 * Drag is an addition, never the only way out: `SheetContent`'s close control, Escape, and
 * the overlay all still dismiss, so the sheet is fully operable from a keyboard. Dismissal
 * goes through a real `Dialog.Close`, so Radix restores focus to the trigger exactly as it
 * does for every other path.
 *
 * Under `prefers-reduced-motion` the sheet still follows the finger — direct manipulation is
 * not animation — but the settle spring is replaced by an instant snap.
 */
export const BottomSheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(function BottomSheetContent({ className, children, style, snapPoints, ...props }, forwardedRef) {
  const reducedMotion = usePrefersReducedMotion();
  const [snapIndex, setSnapIndex] = React.useState(0);
  const snaps = snapPoints ?? [];
  const snap = snaps[snapIndex];
  const larger = snaps[snapIndex + 1];
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const drag = React.useRef<{ startY: number; startTime: number } | null>(null);

  const [offset, setOffset] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Secondary buttons and multi-touch are not drags.
    if (!event.isPrimary || event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    // `performance.now()` rather than `event.timeStamp`: the two are not guaranteed to share
    // an origin across event sources, and a mixed subtraction produces nonsense velocity.
    drag.current = { startY: event.clientY, startTime: performance.now() };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    if (!started) return;

    const delta = event.clientY - started.startY;
    setOffset(delta >= 0 ? delta : delta / UPWARD_RESISTANCE);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    if (!started) return;

    drag.current = null;
    setDragging(false);

    const distance = event.clientY - started.startY;
    const elapsed = performance.now() - started.startTime;
    const velocity = elapsed > 0 ? distance / elapsed : 0;

    const down = distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY;
    const up = distance < -DISMISS_DISTANCE / 2 || velocity < -DISMISS_VELOCITY;
    if (down && snapIndex > 0) {
      setSnapIndex(snapIndex - 1);
    } else if (down) {
      // Click the real close control so Radix runs its own teardown and focus restoration.
      closeRef.current?.click();
    } else if (up && larger !== undefined) {
      setSnapIndex(snapIndex + 1);
    }

    setOffset(0);
  };

  return (
    <SheetContent
      ref={forwardedRef}
      side="bottom"
      className={cn(
        'will-change-transform',
        // The settle spring. Both values are tokens, and the token layer zeroes the duration
        // under reduced motion — this transition is disabled a second time below, because a
        // JS-driven snap must not wait on a transition that may never fire.
        !dragging &&
          !reducedMotion &&
          '[transition-property:transform] [transition-duration:var(--duration-slow)] [transition-timing-function:var(--ease-spring)]',
        className,
      )}
      style={{
        ...style,
        ...(snap === undefined ? {} : { height: SNAP_HEIGHTS[snap], maxHeight: SNAP_HEIGHTS.full }),
        transform: offset === 0 ? undefined : `translateY(${offset}px)`,
      }}
      data-dragging={dragging ? '' : undefined}
      data-snap={snap}
      dragHandleProps={{
        'data-drag-handle': '',
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: handlePointerUp,
      }}
      {...props}
    >
      {children}

      {/* The keyboard and screen-reader way to do what dragging the handle does. */}
      {snaps.length > 1 ? (
        <button
          type="button"
          onClick={() => setSnapIndex(larger === undefined ? 0 : snapIndex + 1)}
          className={cn(
            'text-muted-foreground hover:text-foreground absolute top-4 right-12 rounded-sm p-1',
            'max-md:top-2 max-md:right-14 max-md:flex max-md:size-11 max-md:items-center max-md:justify-center',
            focusRing,
          )}
        >
          {larger === undefined ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronUp className="size-4" aria-hidden />
          )}
          <span className="sr-only">{larger === undefined ? 'Show less' : 'Show more'}</span>
        </button>
      ) : null}

      {/* The dismissal path drag delegates to. Visually redundant with SheetContent's own
          close control, so it is hidden from everything, including assistive technology. */}
      <DialogPrimitive.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />
    </SheetContent>
  );
});

export { DISMISS_DISTANCE, DISMISS_VELOCITY };

/**
 * The scrolling part of a sheet with snap points: it fills what the snap leaves and scrolls
 * itself, contained, so reaching its end never scrolls the page behind (task `103`).
 */
export function BottomSheetBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6', className)}
      {...props}
    />
  );
}
