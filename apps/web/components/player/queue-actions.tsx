'use client';

import type { QueueSelection } from '@youandfriends/contracts';
import { Button } from '@youandfriends/ui';
import { ListEnd, ListPlus, Play } from 'lucide-react';
import * as React from 'react';

import { postJson, RequestFailed } from '@/lib/api/client';
import type { Track } from '@/lib/player/machine';
import { getPlayer } from '@/lib/player/store';

/**
 * Play, or queue, a song list, a project, a folder, or a set of versions (task `073`). What
 * actually lands in the queue is what the server says this viewer may play — resolved at the
 * moment of asking, never assembled from what the page happened to render.
 */
export async function resolveTracks(selection: QueueSelection): Promise<Track[]> {
  const { tracks } = await postJson<{ tracks: Track[] }>('/api/queue/resolve', selection);
  return tracks;
}

export function QueueSourceButtons({
  selection,
  label,
  play = true,
}: {
  readonly selection: QueueSelection;
  /** What is being played, for the buttons' names: "Night Drive". */
  readonly label: string;
  /** Offer "Play" as well as "Play next" and "Add to queue". */
  readonly play?: boolean;
}) {
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function run(action: 'play' | 'next' | 'last') {
    setBusy(true);
    setMessage('');
    try {
      const tracks = await resolveTracks(selection);
      if (tracks.length === 0) {
        setMessage('Nothing here is ready to play yet.');
        return;
      }
      const player = getPlayer();
      if (action === 'play') await player.playQueue(tracks);
      else if (action === 'next') player.queueNext(tracks);
      else player.queueLast(tracks);
      setMessage(
        action === 'play'
          ? `Playing ${label}.`
          : `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} added to the queue.`,
      );
    } catch (error) {
      setMessage(
        error instanceof RequestFailed ? error.message : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {play ? (
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => void run('play')}
          aria-label={`Play ${label}`}
        >
          <Play aria-hidden />
          Play
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void run('next')}
        aria-label={`Play ${label} next`}
      >
        <ListPlus aria-hidden />
        Play next
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void run('last')}
        aria-label={`Add ${label} to the queue`}
      >
        <ListEnd aria-hidden />
        Add to queue
      </Button>
      <p role="status" className="text-caption text-muted-foreground font-sans">
        {message}
      </p>
    </div>
  );
}
