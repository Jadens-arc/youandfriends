'use client';

import * as React from 'react';

import type { SearchResults } from '@/lib/search/service';

/**
 * The palette's search (task `045`): debounced while typing, and every superseded request
 * aborted, so fast typing never shows a stale answer arriving late. Until the new answer comes,
 * the previous results stay put with `loading` set — no flash of empty.
 */

export const SEARCH_DEBOUNCE_MS = 180;

export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly results: SearchResults | null }
  | { readonly status: 'ready'; readonly results: SearchResults }
  | { readonly status: 'error'; readonly results: SearchResults | null };

interface Answer {
  /** The query this answers; while it differs from what is typed, a search is in flight. */
  readonly for: string;
  readonly results: SearchResults | null;
  readonly failed: boolean;
}

export function useSearch(query: string, enabled: boolean): SearchState {
  const [answer, setAnswer] = React.useState<Answer | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // An empty query (recent items) needs no pause for typing.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
              signal: controller.signal,
              cache: 'no-store',
            });
            if (!response.ok) throw new Error(`search failed: ${response.status}`);
            const results = (await response.json()) as SearchResults;
            if (!controller.signal.aborted) setAnswer({ for: query, results, failed: false });
          } catch {
            if (controller.signal.aborted) return;
            setAnswer((previous) => ({
              for: query,
              results: previous?.results ?? null,
              failed: true,
            }));
          }
        })();
      },
      query.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);

  if (!enabled) return { status: 'idle' };
  if (answer === null || answer.for !== query) {
    return { status: 'loading', results: answer?.results ?? null };
  }
  if (answer.failed) return { status: 'error', results: answer.results };
  // A successful answer always carries results.
  return { status: 'ready', results: answer.results as SearchResults };
}
