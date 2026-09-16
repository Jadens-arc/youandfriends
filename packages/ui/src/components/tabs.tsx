'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '../lib/cn';
import { disabledState, focusRing, transition } from '../lib/focus';

/**
 * Tabs — Overview, Lyrics, Files, Comments on the song workspace (docs/DESIGN.md §4).
 *
 * The active tab is marked by an underline AND a weight change, not colour alone. Radix
 * supplies the roving tabindex and arrow-key traversal.
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('border-border inline-flex items-center gap-1 border-b', className)}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative -mb-px inline-flex items-center gap-2 rounded-t border-b-2 border-transparent px-3 py-2',
        'text-body text-muted-foreground font-sans',
        'data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:font-medium',
        transition,
        focusRing,
        disabledState,
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content ref={ref} className={cn('pt-4', focusRing, className)} {...props} />
  );
});
