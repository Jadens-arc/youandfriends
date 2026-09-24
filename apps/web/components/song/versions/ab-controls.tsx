'use client';

import { cn, focusRing, transition } from '@youandfriends/ui';
import { Volume2 } from 'lucide-react';
import * as React from 'react';

import type { CoverSource } from '@/lib/library/covers';
import type { ComparisonTrack } from '@/lib/player/machine';
import { getPlayer, usePlayerState } from '@/lib/player/store';
import { describeLoudness, formatTruePeak } from '@/lib/songs/format';
import type { SongVersion } from '@/lib/songs/workspace';

/**
 * A/B comparison (task `075`): every ready version of the song that is playing, one press away,
 * switched at the same instant with the same playing state.
 *
 * **Loudness is on every option.** Level dominates what people hear as "better"; without the
 * number beside it, the louder mix wins on volume alone (ADR 0004 measures, it does not match).
 * The version sounding is said in words and marked by an icon — never colour alone.
 */
export function ABControls({
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
  const state = usePlayerState();
  const playingThisSong = state.track?.songId === songId;

  const comparison = React.useMemo(
    () =>
      versions
        .filter((version) => version.processingState === 'complete')
        .map((version): ComparisonTrack => ({
          versionId: version.id,
          songId,
          title: songTitle,
          artist,
          versionLabel: `Version ${version.number}`,
          cover,
          durationSeconds: version.durationMs === null ? null : version.durationMs / 1000,
          integratedLufs: version.integratedLufs,
          truePeakDb: version.truePeakDb,
        })),
    [versions, songId, songTitle, artist, cover, album],
  );
  const loudnessOf = React.useMemo(
    () => new Map(versions.map((version) => [version.id, version])),
    [versions],
  );

  // Offer this song's versions to the player while it is the one playing — which also warms the
  // alternate — and withdraw them when the page goes.
  React.useEffect(() => {
    if (!playingThisSong || comparison.length < 2) return;
    getPlayer().setComparison(comparison);
    return () => getPlayer().setComparison(null);
  }, [playingThisSong, comparison]);

  if (!playingThisSong || comparison.length < 2) return null;
  const sounding = state.track?.versionId;

  return (
    <section aria-label="Compare versions" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-caption text-muted-foreground font-sans font-medium tracking-wide uppercase">
          Compare versions
        </h2>
        <p className="text-caption text-muted-foreground font-sans">
          A flips back, V steps through. Same moment, same play state.
        </p>
      </div>
      <div role="radiogroup" aria-label="Sounding version" className="flex flex-wrap gap-2">
        {comparison.map((option) => {
          const active = option.versionId === sounding;
          const version = loudnessOf.get(option.versionId);
          return (
            <button
              key={option.versionId}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => void getPlayer().switchVersion(option.versionId)}
              className={cn(
                'flex min-h-11 flex-col items-start rounded-md border px-3 py-1.5 text-left font-sans',
                active ? 'border-primary bg-card shadow-paper' : 'border-border-subtle',
                transition,
                focusRing,
              )}
            >
              <span className="text-body text-foreground flex items-center gap-1.5 font-medium">
                {active ? <Volume2 aria-hidden className="size-4" /> : null}
                {option.versionLabel}
                {active ? (
                  <span className="text-caption text-muted-foreground">· Sounding</span>
                ) : null}
              </span>
              <span className="text-caption text-muted-foreground tabular">
                {describeLoudness(
                  version?.integratedLufs ?? null,
                  version?.loudnessUnavailable ?? null,
                )}
                {' · '}
                {formatTruePeak(version?.truePeakDb ?? null)}
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" className="text-caption text-muted-foreground font-sans">
        {state.switchNotice ?? ''}
      </p>
    </section>
  );
}
