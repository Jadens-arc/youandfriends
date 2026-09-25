'use client';

import { cn, focusRingOnEspresso, transition } from '@youandfriends/ui';
import { Volume2 } from 'lucide-react';

import { getPlayer, usePlayerState } from '@/lib/player/store';
import { formatLoudness, formatTruePeak } from '@/lib/songs/format';

/**
 * Version switching from the player itself (tasks `075`, `077`): the loaded song's versions as the
 * song page offered them, each with its loudness, the sounding one said in words. Available off
 * the song page, for as long as that song is loaded.
 */
export function VersionPicker() {
  const state = usePlayerState();
  const versions = state.comparison;
  if (versions === null || versions.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Sounding version" className="flex w-full flex-wrap gap-2">
      {versions.map((version) => {
        const active = version.versionId === state.track?.versionId;
        return (
          <button
            key={version.versionId}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => void getPlayer().switchVersion(version.versionId)}
            className={cn(
              'flex min-h-11 flex-col items-start rounded-md border px-3 py-1.5 text-left font-sans',
              active ? 'border-on-espresso bg-on-espresso/10' : 'border-on-espresso/20',
              transition,
              focusRingOnEspresso,
            )}
          >
            <span className="text-body text-on-espresso flex items-center gap-1.5 font-medium">
              {active ? <Volume2 aria-hidden className="size-4" /> : null}
              {version.versionLabel}
              {active ? (
                <span className="text-caption text-secondary-on-espresso">· Sounding</span>
              ) : null}
            </span>
            <span className="text-caption text-secondary-on-espresso tabular">
              {formatLoudness(version.integratedLufs)} · {formatTruePeak(version.truePeakDb)}
            </span>
          </button>
        );
      })}
      <p role="status" className="text-caption text-secondary-on-espresso w-full font-sans">
        {state.switchNotice ?? ''}
      </p>
    </div>
  );
}
