'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { cn } from '../lib/cn';
import { usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';
import { SheetContent, type SheetContentProps } from './sheet';

/** Drag distance past which release dismisses rather than settles back. */
const DISMISS_DISTANCE = 96;

/** Downward speed (px/ms) that dismisses regardless of distance — a flick, not a haul. */
const DISMISS_VELOCITY = 0.5;

/** Resistance applied to upward drag, so the sheet resists rather than refuses. */
const UPWARD_RESISTANCE = 4;

export type BottomSheetContentProps = Omit<SheetContentProps, 'side' | 'dragHandleProps'>;

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
>(function BottomSheetContent({ className, children, style, ...props }, forwardedRef) {
  const reducedMotion = usePrefersReducedMotion();
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

    if (distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      // Click the real close control so Radix runs its own teardown and focus restoration.
      closeRef.current?.click();
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
      style={{ ...style, transform: offset === 0 ? undefined : `translateY(${offset}px)` }}
      data-dragging={dragging ? '' : undefined}
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

      {/* The dismissal path drag delegates to. Visually redundant with SheetContent's own
          close control, so it is hidden from everything, including assistive technology. */}
      <DialogPrimitive.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />
    </SheetContent>
  );
});

export { DISMISS_DISTANCE, DISMISS_VELOCITY };
