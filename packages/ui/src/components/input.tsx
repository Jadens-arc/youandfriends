'use client';

import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, transition } from '../lib/focus';

/**
 * Text input.
 *
 * `text-body` at 15px rather than the 16px iOS needs to avoid zoom-on-focus — the mobile
 * shell (task `014`) sets a 16px minimum on touch viewports rather than inflating every
 * desktop field.
 */
export const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'border-border bg-card text-body text-foreground flex h-9 w-full rounded border px-3 py-1 font-sans',
          'placeholder:text-muted-foreground',
          'file:text-foreground file:border-0 file:bg-transparent file:font-medium',
          transition,
          focusRing,
          disabledState,
          'aria-[invalid=true]:border-destructive',
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Multi-line input. Used for song notes and version notes, not for lyrics — lyrics are a
 * structured Tiptap document (task `081`).
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<'textarea'>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'border-border bg-card text-body text-foreground flex min-h-20 w-full rounded border px-3 py-2 font-sans',
        'placeholder:text-muted-foreground',
        transition,
        focusRing,
        disabledState,
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  );
});

/**
 * Field label.
 *
 * A plain `<label>` rather than a Radix primitive: the native element already does what is
 * needed, and `htmlFor` is the association screen readers rely on.
 */
export const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<'label'>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn(
          'text-caption text-foreground font-sans font-medium',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
