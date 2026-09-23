import { formatRelative } from '@/lib/library/format';
import type { SongSummary } from '@/lib/library/projects';

import { ModuleItem, ModuleSection } from './module-section';

/** The songs most recently changed, among the ones this viewer can open. */
export function RecentSongs({
  songs,
  now,
}: {
  readonly songs: readonly SongSummary[];
  readonly now: Date;
}) {
  return (
    <ModuleSection
      title="Recent songs"
      empty={songs.length === 0 ? 'Songs you and your collaborators touch will gather here.' : null}
    >
      <ul>
        {songs.map((song) => (
          <ModuleItem
            key={song.id}
            primary={song.title}
            secondary={
              <>
                {song.projectName ?? 'Song'} ·{' '}
                <time dateTime={song.updatedAt.toISOString()}>
                  {formatRelative(song.updatedAt, now)}
                </time>
              </>
            }
          />
        ))}
      </ul>
    </ModuleSection>
  );
}
