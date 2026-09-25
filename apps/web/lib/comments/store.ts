'use client';

import * as React from 'react';

/**
 * A song's comments on the client (tasks `090`–`091`): one copy per song, shared by everything on
 * the page that shows them — the Comments tab, and the markers under the waveform — so a comment
 * posted in one place appears in the other without a second fetch deciding otherwise.
 */

export interface VoiceNoteView {
  readonly assetId: string;
  readonly durationMs: number | null;
  readonly state: 'processing' | 'ready' | 'failed';
}

export interface CommentView {
  readonly id: string;
  readonly author: string | null;
  readonly body: string;
  /** A recording carried by the comment (task `093`); absent from older responses. */
  readonly voiceNote?: VoiceNoteView | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

export type AnchorView =
  | { readonly kind: 'general' }
  | { readonly kind: 'timestamp'; readonly versionId: string; readonly ms: number }
  | {
      readonly kind: 'lyric';
      readonly start: Record<string, unknown>;
      readonly end: Record<string, unknown>;
      readonly quote: string;
      readonly scope: 'selection' | 'line' | 'section';
    };

export interface ThreadView {
  readonly id: string;
  readonly anchor: AnchorView;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly comments: readonly CommentView[];
}

export interface CommentsData {
  readonly threads: readonly ThreadView[];
  readonly canComment: boolean;
}

export type CommentsState = CommentsData | 'loading' | 'error';

interface Entry {
  state: CommentsState;
  readonly listeners: Set<() => void>;
  inflight: Promise<void> | null;
}

const entries = new Map<string, Entry>();

export function commentsUrl(songId: string): string {
  return `/api/songs/${encodeURIComponent(songId)}/comments`;
}

function entryFor(songId: string): Entry {
  let entry = entries.get(songId);
  if (entry === undefined) {
    entry = { state: 'loading', listeners: new Set(), inflight: null };
    entries.set(songId, entry);
  }
  return entry;
}

/** Fetch a song's comments again and tell everything showing them. */
export function refreshComments(songId: string): Promise<void> {
  const entry = entryFor(songId);
  entry.inflight ??= (async () => {
    try {
      const response = await fetch(commentsUrl(songId), { cache: 'no-store' });
      const body = response.ok ? ((await response.json()) as Partial<CommentsData>) : null;
      // Only a well-formed answer is used; anything else is shown as "could not be loaded".
      entry.state =
        body !== null && Array.isArray(body.threads) && typeof body.canComment === 'boolean'
          ? (body as CommentsData)
          : 'error';
    } catch {
      entry.state = 'error';
    } finally {
      entry.inflight = null;
    }
    for (const listener of entry.listeners) listener();
  })();
  return entry.inflight;
}

export function useSongComments(songId: string): CommentsState {
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const entry = entryFor(songId);
      entry.listeners.add(listener);
      if (entry.state === 'loading' || entry.listeners.size === 1) void refreshComments(songId);
      return () => {
        entry.listeners.delete(listener);
        // Nothing on screen shows them: the next viewer fetches fresh.
        if (entry.listeners.size === 0) entries.delete(songId);
      };
    },
    [songId],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => entryFor(songId).state,
    () => 'loading',
  );
}

/** Post, then refresh — the pattern every comment action shares. */
export async function sendComment(
  songId: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<boolean> {
  const response = await fetch(`${commentsUrl(songId)}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.ok) await refreshComments(songId);
  return response.ok;
}
