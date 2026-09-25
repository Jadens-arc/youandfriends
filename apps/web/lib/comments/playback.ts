import type { CoverSource } from '@/lib/library/covers';
import type { Track } from '@/lib/player/machine';
import { getPlayer } from '@/lib/player/store';

/**
 * Playing a comment's moment (task `091`).
 *
 * A timestamp comment belongs to the song; the version it names is the one that was playing when
 * it was written. So: if this song is already loaded — any version — seek there, and play. If not,
 * load the version the comment was made on, if it is still playable, or else the song's current
 * one, at that moment.
 */

export interface SongPlayback {
  readonly songId: string;
  readonly songTitle: string;
  readonly artist: string | null;
  readonly cover: CoverSource | null;
  readonly album: string | null;
  /** Playable versions, newest first; `current` marks the song's current version. */
  readonly versions: readonly {
    readonly id: string;
    readonly number: number;
    readonly current: boolean;
  }[];
}

export function trackFor(playback: SongPlayback, versionId: string): Track | null {
  const version =
    playback.versions.find((candidate) => candidate.id === versionId) ??
    playback.versions.find((candidate) => candidate.current) ??
    playback.versions[0];
  if (version === undefined) return null;
  return {
    versionId: version.id,
    songId: playback.songId,
    title: playback.songTitle,
    artist: playback.artist,
    versionLabel: `Version ${version.number}`,
    cover: playback.cover,
    album: playback.album,
  };
}

export function playAtMoment(playback: SongPlayback, versionId: string, ms: number): void {
  const player = getPlayer();
  if (player.getState().track?.songId === playback.songId) {
    player.seek(ms / 1000);
    player.play();
    return;
  }
  const track = trackFor(playback, versionId);
  if (track !== null) void player.load(track, { autoplay: true, startAt: ms / 1000 });
}

/** The version playing now, and where — when it is this song. The moment a new comment anchors. */
export function currentMoment(songId: string): { versionId: string; ms: number } | null {
  const player = getPlayer();
  const track = player.getState().track;
  if (track?.songId !== songId) return null;
  return { versionId: track.versionId, ms: Math.max(0, Math.round(player.currentTime() * 1000)) };
}

/** A song's playable versions, as the comment surfaces need them. */
export function songPlayback(song: {
  readonly songId: string;
  readonly songTitle: string;
  readonly artist: string | null;
  readonly cover: CoverSource | null;
  readonly album: string | null;
  readonly versions: readonly {
    readonly id: string;
    readonly number: number;
    readonly isCurrent: boolean;
    readonly processingState: string;
  }[];
}): SongPlayback {
  return {
    songId: song.songId,
    songTitle: song.songTitle,
    artist: song.artist,
    cover: song.cover,
    album: song.album,
    versions: song.versions
      .filter((version) => version.processingState === 'complete')
      .map((version) => ({ id: version.id, number: version.number, current: version.isCurrent })),
  };
}
