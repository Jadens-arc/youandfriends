'use client';

import { Button } from '@youandfriends/ui';
import { FolderOpen, Link2, Share2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { FavoriteToggle } from '@/components/library/personal';
import { ActionMenu } from '@/components/shell/mobile/sheets/action-menu';

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
      <ActionMenu
        title={songTitle}
        triggerClassName="size-11"
        actions={[
          {
            key: 'copy-link',
            label: 'Copy link to song',
            icon: Link2,
            onSelect: () => void copyLink(),
          },
          ...(projectHref === null
            ? []
            : [
                {
                  key: 'open-project',
                  label: 'Open project',
                  icon: FolderOpen,
                  onSelect: () => router.push(projectHref),
                },
              ]),
        ]}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
