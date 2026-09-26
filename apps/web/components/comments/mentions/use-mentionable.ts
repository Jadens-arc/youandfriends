'use client';

import * as React from 'react';

import type { MentionView } from '@/lib/comments/store';

/**
 * Who may be mentioned on a song (task `094`), fetched the first time someone types `@` and kept
 * for the page. The server decides the list; nothing here widens or narrows it.
 */
export type Mentionable = readonly MentionView[] | 'loading' | 'error';

export interface MentionableList {
  readonly people: readonly MentionView[];
  /** The person asking — never "unreachable" to themselves. */
  readonly you: string;
}

const cache = new Map<string, Promise<MentionableList | null>>();

/** The list for a song: from the server once, then from memory. Null when it could not load. */
export function loadMentionable(songId: string): Promise<MentionableList | null> {
  let pending = cache.get(songId);
  if (pending === undefined) {
    pending = fetch(`/api/songs/${encodeURIComponent(songId)}/mentionable`, { cache: 'no-store' })
      .then(async (response) => {
        const body = response.ok
          ? ((await response.json()) as { people?: unknown; you?: unknown })
          : null;
        return Array.isArray(body?.people) && typeof body.you === 'string'
          ? { people: body.people as MentionView[], you: body.you }
          : null;
      })
      .catch(() => null);
    // A failure is not remembered: the next `@` asks again.
    void pending.then((people) => {
      if (people === null) cache.delete(songId);
    });
    cache.set(songId, pending);
  }
  return pending;
}

/** For tests: forget every list. */
export function clearMentionable(): void {
  cache.clear();
}

export function useMentionable(songId: string | null, wanted: boolean): Mentionable {
  const [people, setPeople] = React.useState<Mentionable>('loading');
  React.useEffect(() => {
    if (songId === null || !wanted) return;
    let cancelled = false;
    void loadMentionable(songId).then((loaded) => {
      if (!cancelled) setPeople(loaded?.people ?? 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [songId, wanted]);
  return people;
}
