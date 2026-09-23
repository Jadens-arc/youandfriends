'use client';

import { cn, focusRingOnEspresso, transition } from '@youandfriends/ui';
import { Clock, Heart, Library, Settings, Share2, Trash2, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

interface Destination {
  // `typedRoutes` checks these against the real route tree, so a destination that does not
  // exist is a build error rather than a dead link.
  href: Route;
  label: string;
  icon: LucideIcon;
}

const DESTINATIONS: readonly Destination[] = [
  { href: '/library', label: 'Library', icon: Library },
  { href: '/recent', label: 'Recent', icon: Clock },
  { href: '/shared', label: 'Shared', icon: Share2 },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/trash', label: 'Trash', icon: Trash2 },
];

/**
 * Espresso navigation rail (docs/DESIGN.md §4).
 *
 * The current destination is marked by `aria-current`, a filled background, AND a left
 * marker — never by colour alone (docs/DESIGN.md §12).
 *
 * These destinations are fixed chrome, not user content. Authorization-filtered navigation
 * arrives with real data in task `041`, where filtering happens in the query rather than by
 * hiding a link.
 */
export function NavigationRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace"
      className="on-espresso bg-espresso flex h-full w-16 shrink-0 flex-col items-center gap-1 py-3"
    >
      <Link
        href="/library"
        className={cn(
          'text-heading mb-2 flex size-10 items-center justify-center rounded font-serif',
          'text-on-espresso',
          transition,
          focusRingOnEspresso,
        )}
      >
        {/* The ampersand alone is the mark; no separate logo is invented (docs/DESIGN.md §16). */}
        <span aria-hidden>&amp;</span>
        <span className="sr-only">You &amp; Friends — go to library</span>
      </Link>

      <ul className="flex flex-col items-center gap-1">
        {DESTINATIONS.map((destination) => (
          <RailLink key={destination.href} destination={destination} pathname={pathname} />
        ))}
      </ul>

      {/* Settings sits apart from the content destinations, at the foot of the rail: it is about
          the workspace, not a place its music lives (task `031`). */}
      <ul className="mt-auto flex flex-col items-center gap-1">
        <RailLink destination={SETTINGS} pathname={pathname} />
      </ul>
    </nav>
  );
}

const SETTINGS: Destination = { href: '/settings', label: 'Settings', icon: Settings };

function RailLink({ destination, pathname }: { destination: Destination; pathname: string }) {
  const { href, label, icon: Icon } = destination;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex size-11 flex-col items-center justify-center gap-0.5 rounded',
          'text-secondary-on-espresso hover:text-on-espresso',
          active && 'bg-on-espresso/10 text-on-espresso',
          transition,
          focusRingOnEspresso,
        )}
      >
        {active ? (
          <span aria-hidden className="bg-on-espresso absolute left-0 h-5 w-0.5 rounded-r-full" />
        ) : null}
        <Icon className="size-4" aria-hidden />
        <span className="text-[0.625rem] leading-none">{label}</span>
      </Link>
    </li>
  );
}
