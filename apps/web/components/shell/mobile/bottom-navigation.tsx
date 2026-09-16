'use client';

import { cn, focusRingOnEspresso, transition } from '@youandfriends/ui';
import { Clock, Heart, Library, Search, Share2, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

interface Destination {
  href: Route;
  label: string;
  icon: LucideIcon;
}

/**
 * Bottom navigation (docs/DESIGN.md §10).
 *
 * Five destinations at most — a sixth makes each target too narrow for a thumb. Trash lives
 * in the library's overflow on mobile rather than taking a slot here; it is a rare
 * destination and the cost of a cramped bar is paid on every other tap.
 */
const DESTINATIONS: readonly Destination[] = [
  { href: '/library', label: 'Library', icon: Library },
  { href: '/recent', label: 'Recent', icon: Clock },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/shared', label: 'Shared', icon: Share2 },
  { href: '/favorites', label: 'Favorites', icon: Heart },
];

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace"
      className={cn(
        'on-espresso border-border-on-espresso flex shrink-0 items-stretch justify-around border-t',
        'bg-espresso',
        // Clear the home indicator. Without this the bar sits under it and the bottom row
        // of targets becomes unreliable.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {DESTINATIONS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 44x44 minimum (docs/DESIGN.md §10). Declared on the target itself rather
              // than via a pseudo-element, because here the target IS the visual element.
              'relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 py-2',
              'text-secondary-on-espresso',
              active && 'text-on-espresso',
              transition,
              focusRingOnEspresso,
            )}
          >
            {active ? (
              <span
                aria-hidden
                className="bg-on-espresso absolute top-0 h-0.5 w-8 rounded-b-full"
              />
            ) : null}
            <Icon className="size-5" aria-hidden />
            <span className="text-[0.625rem] leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
