import { cn, focusRing, transition } from '@youandfriends/ui';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import type { VisibleFolder } from '@/lib/library/tree';

export interface FolderBreadcrumbsProps {
  readonly crumbs: readonly VisibleFolder[];
  readonly className?: string;
}

function hrefFor(crumbs: readonly VisibleFolder[], index: number): Route {
  return `/library/${crumbs
    .slice(0, index + 1)
    .map((crumb) => crumb.id)
    .join('/')}` as Route;
}

/**
 * The current folder's path, reflecting exactly what `breadcrumbFor` (`lib/library/tree.ts`)
 * decided is visible — see that function for why a scope-limited collaborator's or a denied
 * branch's real ancestors never appear here.
 */
export function FolderBreadcrumbs({ crumbs, className }: FolderBreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="text-body flex min-w-0 items-center gap-1 font-sans">
        <li className="shrink-0">
          <Link
            href={'/library' as Route}
            className={cn(
              'text-muted-foreground hover:text-foreground rounded-sm',
              transition,
              focusRing,
            )}
          >
            Library
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              {isLast ? (
                <span aria-current="page" className="text-foreground truncate font-medium">
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={hrefFor(crumbs, index)}
                  className={cn(
                    'text-muted-foreground hover:text-foreground truncate rounded-sm',
                    transition,
                    focusRing,
                  )}
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
