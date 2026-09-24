import type { Track } from '@/lib/player/machine';
import { getPlayer } from '@/lib/player/store';

/** Tying lyrics timestamps to the one player (task `083`). */

export interface LyricsTiming {
  readonly songId: string;
  /** This song's playable version, to start playback from a timestamp when nothing is loaded. */
  readonly track: Track | null;
}

/** The loaded song's playhead in milliseconds, or null when it is not this song that is loaded. */
export function playheadFor(songId: string): number | null {
  const player = getPlayer();
  if (player.getState().track?.songId !== songId) return null;
  return player.currentTime() * 1000;
}

/** Play this song from `ms`: seek if it is loaded, otherwise load its playable version there. */
export function playFrom(timing: LyricsTiming, ms: number): void {
  const player = getPlayer();
  if (player.getState().track?.songId === timing.songId) {
    player.seek(ms / 1000);
    player.play();
    return;
  }
  if (timing.track !== null) void player.load(timing.track, { autoplay: true, startAt: ms / 1000 });
}
