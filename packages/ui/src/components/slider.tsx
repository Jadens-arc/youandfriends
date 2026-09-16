'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, transition } from '../lib/focus';

/**
 * Slider.
 *
 * This is the accessible alternative to the waveform (task `072`). `docs/DESIGN.md` §12
 * requires waveform interactions to have a keyboard and textual path, and a canvas is
 * invisible to assistive technology — so for some users this IS the seek control, not a
 * fallback. It is built accordingly: arrow keys, Home/End, and an announced value.
 */
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(function Slider({ className, ...props }, ref) {
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
      <SliderPrimitive.Track className="bg-border-strong relative h-1 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'border-border-strong bg-card shadow-paper block size-4 rounded-full border',
          transition,
          focusRing,
          disabledState,
        )}
      />
    </SliderPrimitive.Root>
  );
});
