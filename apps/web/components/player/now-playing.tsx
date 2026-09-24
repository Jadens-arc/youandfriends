'use client';

import type { PlayerState } from '@/lib/player/machine';
import { usePlayerState } from '@/lib/player/store';

/**
 * The player's state in words (task `070`) — what the transport UI (task `071`) builds on.
 * Every status and every error kind has a sentence; none is conveyed by an icon or colour alone.
 */
export function describePlayer(state: PlayerState): { title: string; detail: string } {
  if (state.track === null) return { title: 'Nothing playing', detail: '' };
  const title = `${state.track.title} · ${state.track.versionLabel}`;
  if (state.status === 'error') {
    const detail = {
      network: 'Connection lost — trying again',
      expired: 'Reconnecting',
      decode: 'This version can’t be played',
      unauthorized: 'You no longer have access to this song',
      not_ready: 'Still processing — try again shortly',
      unavailable: 'Playback isn’t available right now',
    }[state.error?.kind ?? 'network'];
    return { title, detail };
  }
  const detail = {
    idle: '',
    loading: 'Loading',
    ready: 'Ready',
    playing: 'Playing',
    paused: 'Paused',
    seeking: 'Seeking',
    stalled: 'Buffering',
    ended: 'Finished',
  }[state.status];
  return { title, detail };
}

export function NowPlaying({ className }: { readonly className?: string }) {
  const { title, detail } = describePlayer(usePlayerState());
  return (
    <div className={className}>
      <p className="text-caption text-on-espresso truncate font-sans">{title}</p>
      {detail === '' ? null : (
        <p className="text-secondary-on-espresso truncate font-sans text-[0.6875rem]">{detail}</p>
      )}
    </div>
  );
}
