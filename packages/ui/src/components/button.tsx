'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, focusRingOnEspresso, transition } from '../lib/focus';

/**
 * Button.
 *
 * Radii sit in the 8–14 px band — `rounded-full` is reserved for genuinely circular controls
 * such as the player's play button, because pill-shaped everything reads as generic SaaS
 * (docs/DESIGN.md §11).
 */
const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded font-sans text-body font-medium',
    transition,
    disabledState,
    focusRing,
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        /** Espresso fill with a soft inset highlight, per the dark-control direction. */
        primary: 'bg-primary text-primary-foreground shadow-inset hover:bg-primary/90',
        /** Paper with a fine warm border — the default for most actions. */
        secondary: 'border border-border bg-card text-foreground shadow-paper hover:bg-muted',
        /** Text-only, for low-emphasis actions in dense areas. */
        ghost: 'text-foreground hover:bg-border-subtle',
        /** Destructive uses the AA-safe rust variant, never the decorative one. */
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        /** For the navigation rail and player, where the light ring is invisible. */
        onEspresso: cn('text-on-espresso hover:bg-on-espresso/10', focusRingOnEspresso),
      },
      // Every size is at least 44×44 px on a phone (task `101`, WCAG 2.5.5): the compact sizes
      // are for a pointer, and a thumb gets the full target whatever the caller remembered.
      size: {
        sm: 'h-8 px-2.5 text-caption max-md:min-h-11 max-md:min-w-11',
        md: 'h-9 px-3.5 max-md:min-h-11 max-md:min-w-11',
        lg: 'h-11 px-5 text-heading',
        /** Square icon button: 36 px for a pointer, 44 px on a phone. */
        icon: 'size-9 max-md:size-11',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element, so a link can look like a button without nesting one. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      // Without this, a button inside a form submits it — a recurring source of surprise.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { buttonVariants };
