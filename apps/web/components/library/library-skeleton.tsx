import { Skeleton, cn } from '@youandfriends/ui';

import type { LibraryView } from '@/lib/library/sort';

import { GRID_CLASSES, LIST_CLASSES } from './project-grid';

/** How many placeholder cards to draw — enough to fill a first screen at every breakpoint. */
export const SKELETON_COUNT = 10;

/**
 * The library while it loads, built from the same grid classes and the same inner structure
 * as the real cards (`project-card.tsx`) — a square cover, a serif-height title line, an
 * artist line, and a metadata row of the same minimum height — so nothing moves when the data
 * lands. `aria-busy` tells assistive technology the region is loading; the skeleton blocks
 * themselves are hidden from it.
 */
export function LibrarySkeleton({ view = 'grid' }: { readonly view?: LibraryView }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading projects"
      role="status"
      className="flex flex-col gap-4"
    >
      <div className="flex h-9 items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-64" />
      </div>
      <ul aria-hidden className={cn(view === 'grid' ? GRID_CLASSES : LIST_CLASSES)}>
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <li key={index} className="min-w-0" data-testid="project-skeleton">
            {view === 'grid' ? <CardSkeleton /> : <RowSkeleton />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Skeleton className="aspect-square w-full rounded-md" />
      <div className="flex flex-col gap-0.5 px-0.5">
        {/* Line boxes at the real type's line heights: heading 1.125rem × 1.35, caption
            0.8125rem × 1.45 — so the text block is exactly as tall as the card's. */}
        <div className="flex h-[1.519rem] items-center">
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex h-[1.178rem] items-center">
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="mt-1 flex min-h-6 items-center justify-between">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="size-6 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1fr)_6rem_8rem_auto]">
      <Skeleton className="aspect-square w-full rounded-md" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="hidden h-3 w-1/2 md:block" />
      <Skeleton className="hidden h-3 w-12 md:block" />
      <Skeleton className="hidden h-3 w-16 md:block" />
      <Skeleton className="size-6 rounded-full" />
    </div>
  );
}
