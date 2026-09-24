'use client';

import { Button } from '@youandfriends/ui';
import { Star } from 'lucide-react';
import * as React from 'react';

import { postJson } from '@/lib/api/client';

/**
 * The favourite toggle (task `044`): optimistic, and honest when it fails — the star goes back
 * and a sentence says so, rather than silently disagreeing with the server.
 */
export function FavoriteToggle({
  targetType,
  targetId,
  initial,
  name,
}: {
  readonly targetType: 'folder' | 'project' | 'song';
  readonly targetId: string;
  readonly initial: boolean;
  /** For the accessible name: "Add Headlights to favorites". */
  readonly name: string;
}) {
  const [favorite, setFavorite] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function toggle() {
    const next = !favorite;
    setFavorite(next);
    setError(null);
    setPending(true);
    try {
      await postJson('/api/favorites', { targetType, targetId, favorite: next }, 'PUT');
    } catch {
      setFavorite(!next);
      setError(
        next
          ? 'Couldn’t add it to favorites. Try again.'
          : 'Couldn’t remove it from favorites. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center">
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        onClick={() => void toggle()}
        disabled={pending}
        className="size-11"
      >
        <Star aria-hidden className={favorite ? 'fill-current' : undefined} />
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-caption text-destructive font-sans">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * Records that this page was opened, once per visit, after it has rendered. A beacon rather than
 * a fetch so leaving the page does not cancel it; failures are not worth telling anyone about.
 */
export function RecordView({
  targetType,
  targetId,
}: {
  readonly targetType: 'project' | 'song';
  readonly targetId: string;
}) {
  React.useEffect(() => {
    const body = JSON.stringify({ kind: 'viewed', targetType, targetId });
    try {
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/recents', new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch {
      // Fall through to fetch.
    }
    void fetch('/api/recents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [targetType, targetId]);
  return null;
}

/** Record a play (task `044`) — called by the player when a track actually starts. */
export function recordPlay(songId: string): void {
  void fetch('/api/recents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'played', targetType: 'song', targetId: songId }),
    keepalive: true,
  }).catch(() => {});
}
