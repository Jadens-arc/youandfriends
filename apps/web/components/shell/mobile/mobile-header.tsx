'use client';

import { cn, focusRing, transition } from '@youandfriends/ui';
import { ChevronLeft, Settings } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useBackTarget } from './back-target';

const SECTION_LABELS: Readonly<Record<string, string>> = {
  library: 'Library',
  recent: 'Recent',
  search: 'Search',
  shared: 'Shared',
  favorites: 'Favorites',
  trash: 'Trash',
  settings: 'Settings',
  members: 'Members',
};

function labelFor(segment: string | undefined): string {
  if (!segment) return 'Library';
  return SECTION_LABELS[segment] ?? 'Back';
}

/**
 * Mobile header (docs/DESIGN.md §10).
 *
 * The phone navigates by drill-down — folder → project → song — where the desktop keeps
 * everything on screen at once. Each level is a real route, so the browser's own back
 * gesture and the history stack work without help.
 *
 * The visible back control is a link to the parent path, not `router.back()`. A history pop
 * is wrong the moment a drill-down page is opened directly — from a share link, a bookmark,
 * or a refresh — where it leaves the workspace entirely. A parent link always lands
 * somewhere real, and is the only form a screen reader can announce a destination for.
 *
 * Hidden on desktop, where the rail and the command bar serve this role.
 */
export function MobileHeader() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const section = segments[0];

  // One segment is a root destination; more means we have drilled in and can go up.
  const pathParent = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : null;
  // A page whose logical parent is not its path prefix (a song's is its project) says so.
  const declared = useBackTarget();
  const parent = declared?.href ?? pathParent;
  const parentLabel = declared?.label ?? labelFor(segments.at(-2));

  return (
    <header
      className={cn(
        'border-border flex h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden',
        // Clear the notch when the browser chrome is hidden.
        'pt-[env(safe-area-inset-top)]',
      )}
    >
      {parent === null ? (
        <h1 className="text-title text-foreground px-2 font-serif">{labelFor(section)}</h1>
      ) : (
        <Link
          // `typedRoutes` cannot check a path assembled at runtime. The segments come from
          // `usePathname`, so the parent of a route that exists exists too.
          href={parent as Route}
          aria-label={`Back to ${parentLabel}`}
          className={cn(
            'text-foreground flex min-h-11 min-w-11 items-center gap-0.5 rounded-sm pr-3',
            transition,
            focusRing,
          )}
        >
          <ChevronLeft className="size-5 shrink-0" aria-hidden />
          <span className="text-body max-w-[60vw] truncate font-sans">{parentLabel}</span>
        </Link>
      )}

      {/* The phone's way to settings. The bottom bar holds the five places music lives and has no
          room for a sixth, so settings rides in the header of every root destination instead. */}
      {parent === null && section !== 'settings' ? (
        <Link
          href="/settings"
          aria-label="Settings"
          className={cn(
            'text-foreground ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-sm',
            transition,
            focusRing,
          )}
        >
          <Settings className="size-5" aria-hidden />
        </Link>
      ) : null}
    </header>
  );
}
