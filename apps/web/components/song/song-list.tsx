import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';

import { formatDuration, spokenDuration } from '@/lib/songs/format';
import { songHref } from '@/lib/songs/routes';
import type { SiblingSong } from '@/lib/songs/workspace';

import { WorkStatusBadge } from './status-badge';

/**
 * The song list on the left of the desktop split (`docs/DESIGN.md` §4), and the whole of the
 * project view on a phone.
 *
 * A list of links, with the open song marked by `aria-current` *and* by weight and a rule — the
 * selection is never the tint alone.
 */
export function SongList({
  songs,
  currentSongId,
  label,
}: {
  readonly songs: readonly SiblingSong[];
  readonly currentSongId: string | null;
  readonly label: string;
}) {
  if (songs.length === 0) {
    return (
      <p className="text-body text-muted-foreground p-4 font-sans italic">
        No songs here yet. Upload a mix to start one.
      </p>
    );
  }

  return (
    <nav aria-label={label}>
      <ol className="flex flex-col py-2">
        {songs.map((song, index) => {
          const current = song.id === currentSongId;
          return (
            <li key={song.id}>
              <Link
                href={songHref(song.id)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 border-l-2 px-4 py-2',
                  current
                    ? 'border-primary bg-border-subtle text-foreground font-medium'
                    : 'hover:bg-border-subtle text-foreground border-transparent',
                  transition,
                  focusRing,
                )}
              >
                <span
                  aria-hidden
                  className="text-caption text-muted-foreground tabular w-5 text-right font-mono"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-body block truncate font-serif">{song.title}</span>
                  <span className="text-caption text-muted-foreground flex items-center gap-2 font-sans">
                    <span className="tabular" aria-label={spokenDuration(song.durationMs)}>
                      {formatDuration(song.durationMs)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {song.versionCount === 1 ? '1 version' : `${song.versionCount} versions`}
                    </span>
                  </span>
                </span>
                <WorkStatusBadge status={song.status} />
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
