import { cn } from '@youandfriends/ui';
import * as React from 'react';

/**
 * The frame every secondary module shares: a small sans heading, then its content or a warm
 * empty line. Secondary by design (`docs/DESIGN.md` §4) — quieter than the shelf of projects
 * beside it, never competing with the covers for attention.
 */
export function ModuleSection({
  title,
  empty,
  children,
  className,
}: {
  readonly title: string;
  /** Shown instead of `children` when there is nothing to list — a sentence, not "No data". */
  readonly empty: string | null;
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2', className)}>
      <h2
        id={id}
        className="text-caption text-muted-foreground font-sans font-medium tracking-wide uppercase"
      >
        {title}
      </h2>
      {empty === null ? (
        children
      ) : (
        <p className="text-caption text-muted-foreground font-sans italic">{empty}</p>
      )}
    </section>
  );
}

/** One line in a module list: a primary label and a quiet secondary one. */
export function ModuleItem({
  primary,
  secondary,
}: {
  readonly primary: React.ReactNode;
  readonly secondary?: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col py-1">
      <span className="text-body text-foreground truncate font-sans">{primary}</span>
      {secondary === undefined ? null : (
        <span className="text-caption text-muted-foreground truncate font-sans">{secondary}</span>
      )}
    </li>
  );
}
