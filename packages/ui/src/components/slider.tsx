'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, focusRingOnEspresso, transition } from '../lib/focus';

/**
 * Slider.
 *
 * This is the accessible alternative to the waveform (task `072`). `docs/DESIGN.md` §12
 * requires waveform interactions to have a keyboard and textual path, and a canvas is
 * invisible to assistive technology — so for some users this IS the seek control, not a
 * fallback. It is built accordingly: arrow keys, Home/End, and an announced value.
 */
export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /**
   * `espresso` for the player bar: an on-espresso track and the second focus ring treatment,
   * without which the thumb's focus would be invisible against the dark bar (task `071`).
   */
  readonly tone?: 'paper' | 'espresso';
  /** The thumb's accessible name — the thumb is what receives focus, not the root. */
  readonly thumbLabel?: string;
  /** Spoken instead of the raw number, e.g. "1:23 of 4:56". */
  readonly valueText?: string;
}

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider({ className, tone = 'paper', thumbLabel, valueText, ...props }, ref) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none items-center select-none',
        'data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative h-1 w-full grow overflow-hidden rounded-full',
          tone === 'espresso' ? 'bg-on-espresso/20' : 'bg-border-strong',
        )}
      >
        <SliderPrimitive.Range
          className={cn('absolute h-full', tone === 'espresso' ? 'bg-on-espresso' : 'bg-primary')}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        {...(thumbLabel === undefined ? {} : { 'aria-label': thumbLabel })}
        {...(valueText === undefined ? {} : { 'aria-valuetext': valueText })}
        className={cn(
          'block size-4 rounded-full border',
          tone === 'espresso'
            ? 'border-on-espresso/40 bg-on-espresso shadow-inset'
            : 'border-border-strong bg-card shadow-paper',
          transition,
          tone === 'espresso' ? focusRingOnEspresso : focusRing,
          disabledState,
        )}
      />
    </SliderPrimitive.Root>
  );
});
