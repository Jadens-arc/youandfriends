import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Badge — status and metadata.
 *
 * Every variant pairs its colour with text. `docs/DESIGN.md` §12 forbids encoding state by
 * colour alone, and a badge is precisely where that temptation arises: version state, upload
 * state, and processing status all pass through here.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-sans text-caption font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-muted-foreground',
        current: 'border-olive-text/30 bg-olive/15 text-olive-text',
        attention: 'border-ochre-text/30 bg-ochre/15 text-ochre-text',
        problem: 'border-destructive/30 bg-rust/15 text-destructive',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
