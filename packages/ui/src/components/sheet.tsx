'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/focus';
import { DialogOverlay } from './dialog';

/**
 * Sheet.
 *
 * The bottom variant is the mobile workhorse: comment threads, version lists, and file
 * details all present this way (docs/DESIGN.md §10). Drag-to-dismiss arrives with the mobile
 * shell in task `014`; the close control here is the keyboard path, which must exist
 * regardless.
 *
 * `overscroll-contain` matters more than it looks — without it, scrolling to the end of
 * sheet content scrolls the page behind, which feels broken immediately.
 */
const sheetVariants = cva(
  cn(
    'fixed z-50 flex flex-col gap-4 border-border bg-popover p-6 shadow-overlay overscroll-contain',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
  ),
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b rounded-b-lg',
        bottom: cn(
          'inset-x-0 bottom-0 border-t rounded-t-lg',
          // Clear the home indicator, or content hides behind it.
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        ),
        left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
        right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
      },
    },
    defaultVariants: { side: 'bottom' },
  },
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent({ side = 'bottom', className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // `p-6` lives inside the base variant, not here. Applied after the side variant it
        // would win the tailwind-merge conflict and silently delete the bottom variant's
        // safe-area padding, dropping content behind the home indicator.
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {side === 'bottom' ? (
          // A grab handle signals draggability and gives the eye somewhere to land.
          <div
            className="bg-border-strong mx-auto -mt-2 h-1 w-10 shrink-0 rounded-full"
            aria-hidden
          />
        ) : null}
        {children}
        <DialogPrimitive.Close
          className={cn(
            'text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm p-1',
            transition,
            focusRing,
          )}
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-title text-foreground font-serif', className)}
      {...props}
    />
  );
});

export const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-body text-muted-foreground font-sans', className)}
      {...props}
    />
  );
});

export { sheetVariants };
