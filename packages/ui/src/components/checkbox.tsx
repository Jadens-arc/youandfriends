'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, touchTarget, transition } from '../lib/focus';

/**
 * Checkbox.
 *
 * The indeterminate state gets its own glyph rather than a different shade, because state
 * must never be conveyed by colour alone (docs/DESIGN.md §12).
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer border-border-strong bg-card size-4 shrink-0 rounded-[4px] border',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        transition,
        focusRing,
        disabledState,
        touchTarget,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

/** Switch — for settings that take effect immediately, unlike a checkbox in a form. */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        // A switch is one of the few controls where a pill shape is correct — it is the
        // platform convention and reads as a physical toggle.
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-border-strong',
        transition,
        focusRing,
        disabledState,
        touchTarget,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'bg-card shadow-paper pointer-events-none block size-4 rounded-full ring-0',
          'transition-transform [transition-duration:var(--duration-fast)]',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
