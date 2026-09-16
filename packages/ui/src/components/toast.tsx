'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/focus';

/**
 * Toast.
 *
 * Variants pair colour with an accessible role: `problem` announces assertively, everything
 * else politely. State is never colour alone (docs/DESIGN.md §12), so callers give each
 * toast a title that says what happened.
 */
export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed z-100 flex max-h-screen w-full flex-col gap-2 p-4 sm:top-auto sm:right-0 sm:max-w-sm',
        // Above the mini-player and the bottom navigation on mobile.
        'bottom-[calc(7.5rem+env(safe-area-inset-bottom))] sm:bottom-24',
        className,
      )}
      {...props}
    />
  );
});

export interface ToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: 'neutral' | 'problem';
}

export const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  function Toast({ className, variant = 'neutral', ...props }, ref) {
    return (
      <ToastPrimitive.Root
        ref={ref}
        // A failure interrupts; a confirmation waits its turn.
        type={variant === 'problem' ? 'foreground' : 'background'}
        className={cn(
          'shadow-overlay relative flex items-start gap-3 overflow-hidden rounded-md border p-4',
          variant === 'problem' ? 'border-destructive/30 bg-popover' : 'border-border bg-popover',
          className,
        )}
        {...props}
      />
    );
  },
);

export const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={cn('text-body text-foreground font-sans font-medium', className)}
      {...props}
    />
  );
});

export const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={cn('text-caption text-muted-foreground font-sans', className)}
      {...props}
    />
  );
});

export const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(function ToastAction({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Action
      ref={ref}
      className={cn(
        'text-caption text-foreground ml-auto shrink-0 rounded-sm px-2 py-1 font-sans font-medium',
        'hover:bg-border-subtle',
        transition,
        focusRing,
        className,
      )}
      {...props}
    />
  );
});

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Close
      ref={ref}
      className={cn(
        'text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-sm p-1',
        transition,
        focusRing,
        className,
      )}
      {...props}
    >
      <X className="size-3.5" aria-hidden />
      <span className="sr-only">Dismiss</span>
    </ToastPrimitive.Close>
  );
});
