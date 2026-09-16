'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Tooltip.
 *
 * A tooltip is never the only way to learn what a control does — it is unavailable to touch
 * users and unreliable for screen readers. Icon-only buttons carry an `aria-label` or an
 * `sr-only` span regardless (docs/DESIGN.md §12).
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'bg-espresso z-50 overflow-hidden rounded-sm px-2 py-1',
          'text-caption text-on-espresso shadow-overlay font-sans',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
