'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@youandfriends/ui';
import { Link2, MoreHorizontal, Share2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { FavoriteToggle } from '@/components/library/personal';

/**
 * The song header's actions: favourite, share, and the overflow menu (`docs/DESIGN.md` §4).
 *
 * Share is present and honest about not being available: external share links are deferred
 * work (task `200`), and a button that opened an empty dialog would be the lie.
 */
export function SongActions({
  songId,
  songTitle,
  isFavorite,
  projectHref,
}: {
  readonly songId: string;
  readonly songTitle: string;
  readonly isFavorite: boolean;
  /** The project's page, when this viewer can open it. */
  readonly projectHref: Route | null;
}) {
  const router = useRouter();
  const shareHint = React.useId();
  const [announcement, setAnnouncement] = React.useState('');

  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete('version');
    try {
      await navigator.clipboard.writeText(url.toString());
      setAnnouncement('Link to this song copied');
    } catch {
      setAnnouncement('Could not copy the link. Copy it from the address bar instead.');
    }
  }

  return (
    <div className="flex items-center gap-1">
      <FavoriteToggle targetType="song" targetId={songId} initial={isFavorite} name={songTitle} />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Share"
        aria-describedby={shareHint}
        disabled
        className="size-11"
      >
        <Share2 aria-hidden />
      </Button>
      <span id={shareHint} className="sr-only">
        Sharing links are not available yet.
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions" className="size-11">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 aria-hidden />
            Copy link to song
          </DropdownMenuItem>
          {projectHref === null ? null : (
            <DropdownMenuItem onSelect={() => router.push(projectHref)}>
              Open project
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
