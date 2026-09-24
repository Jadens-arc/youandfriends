'use client';

import { Button } from '@youandfriends/ui';
import { Pause, Play } from 'lucide-react';

import type { CoverSource } from '@/lib/library/covers';
import { getPlayer, usePlayerState } from '@/lib/player/store';

/**
 * Play one version in the persistent player (task `071`). Offered only for a version whose
 * stream is ready; the player itself asks the server for an authorized URL (task `070`).
 * Pressing it on the version already loaded toggles play and pause rather than reloading.
 */
export function PlayVersionButton({
  songId,
  songTitle,
  artist,
  cover,
  versionId,
  versionNumber,
}: {
  readonly songId: string;
  readonly songTitle: string;
  readonly artist: string | null;
  readonly cover: CoverSource | null;
  readonly versionId: string;
  readonly versionNumber: number;
}) {
  const state = usePlayerState();
  const loaded = state.track?.versionId === versionId;
  const playing = loaded && state.wantsToPlay;
  const label = `Version ${versionNumber}`;
  return (
    <Button
      variant="primary"
      size="sm"
      aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      onClick={() => {
        const player = getPlayer();
        if (loaded) {
          player.toggle();
          return;
        }
        void player.load({
          versionId,
          songId,
          title: songTitle,
          artist,
          versionLabel: label,
          cover,
        });
      }}
    >
      {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      {playing ? 'Pause' : 'Play'}
    </Button>
  );
}
