'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@youandfriends/ui';
import { Link2, MoreHorizontal, Share2, Star } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * The song header's actions: favourite, share, and the overflow menu (`docs/DESIGN.md` §4).
 *
 * `onToggleFavorite` is optional because the toggle's behaviour — optimistic, audited — belongs
 * to task `044`; until a caller supplies it the button reports the state and is inert, and says
 * so rather than looking broken.
 *
 * Share is present and honest about not being available: external share links are deferred
 * work (task `200`), and a button that opened an empty dialog would be the lie.
 */
export function SongActions({
  isFavorite,
  onToggleFavorite,
  projectHref,
}: {
  readonly isFavorite: boolean;
  readonly onToggleFavorite?: (() => void) | undefined;
  /** The project's page, when this viewer can open it. */
  readonly projectHref: Route | null;
}) {
  const router = useRouter();
  const shareHint = React.useId();
  const favoriteHint = React.useId();
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
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? 'Favorite' : 'Add to favorites'}
        aria-describedby={onToggleFavorite === undefined ? favoriteHint : undefined}
        disabled={onToggleFavorite === undefined}
        onClick={onToggleFavorite}
        className="size-11"
      >
        <Star aria-hidden className={isFavorite ? 'fill-current' : undefined} />
      </Button>
      {onToggleFavorite === undefined ? (
        <span id={favoriteHint} className="sr-only">
          {isFavorite ? 'This song is one of your favorites.' : 'Not one of your favorites.'}
        </span>
      ) : null}
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
