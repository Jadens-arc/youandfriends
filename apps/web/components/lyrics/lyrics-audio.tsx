'use client';

import { LoopControls } from '@/components/player/loop-controls';
import { PlayVersionButton } from '@/components/player/play-version-button';
import { Waveform } from '@/components/player/waveform/waveform';
import type { CoverSource } from '@/lib/library/covers';
import type { SongVersion } from '@/lib/songs/workspace';

/**
 * The song's audio beside its lyrics (task `081`, `docs/DESIGN.md` §6): the current version's
 * play button, compact waveform, and loop controls — the same player the rest of the app uses,
 * so playback carries on as the writer moves between tabs.
 */
export function LyricsAudio({
  songId,
  songTitle,
  artist,
  cover,
  album = null,
  versions,
}: {
  readonly songId: string;
  readonly songTitle: string;
  readonly artist: string | null;
  readonly cover: CoverSource | null;
  readonly album?: string | null;
  readonly versions: readonly SongVersion[];
}) {
  const playable = versions.filter((version) => version.processingState === 'complete');
  const version = playable.find((candidate) => candidate.isCurrent) ?? playable[0] ?? null;
  if (version === null) {
    return (
      <p className="text-caption text-muted-foreground font-sans">
        {versions.length === 0
          ? 'No audio yet — upload a version to hear it beside the lyrics.'
          : 'The audio is still being prepared.'}
      </p>
    );
  }
  const versionLabel = `Version ${version.number}`;
  return (
    <div className="border-border-subtle bg-card flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-3">
        <PlayVersionButton
          songId={songId}
          songTitle={songTitle}
          artist={artist}
          cover={cover}
          album={album}
          versionId={version.id}
          versionNumber={version.number}
        />
        <p className="text-caption text-muted-foreground font-sans">
          {versionLabel}
          {version.isCurrent ? ' · current' : ''}
        </p>
      </div>
      <div className="h-16">
        <Waveform
          variant="compact"
          track={{
            versionId: version.id,
            songId,
            title: songTitle,
            artist,
            versionLabel,
            cover,
            album,
          }}
          label={`Seek in ${songTitle}, ${versionLabel}`}
        />
      </div>
      <LoopControls songId={songId} />
    </div>
  );
}
