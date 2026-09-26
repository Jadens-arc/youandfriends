'use client';

import type { Reaction } from '@youandfriends/contracts';
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

export interface MentionView {
  readonly id: string;
  readonly name: string;
}

export interface ReactionView {
  readonly reaction: Reaction;
  readonly count: number;
  readonly mine: boolean;
  readonly people: readonly string[];
}

export interface CommentView {
  readonly id: string;
  /** Task `094`; absent from older responses. */
  readonly authorId?: string | null;
  readonly author: string | null;
  readonly body: string;
  /** A recording carried by the comment (task `093`); absent from older responses. */
  readonly voiceNote?: VoiceNoteView | null;
  /** The people the body's `<@id>` references reached, by their current names (task `094`). */
  readonly mentions?: readonly MentionView[];
  readonly reactions?: readonly ReactionView[];
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

/** What a saved comment answers: anyone it mentions who cannot see the song (task `094`). */
export interface CommentSent {
  readonly unreachedMentions: readonly string[];
}

/** Send a comment action — anything under `/api/songs/:songId/comments`. `false` if refused. */
export async function sendTo(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<false | CommentSent> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) return false;
  const answer = (await response.json().catch(() => null)) as {
    unreachedMentions?: unknown;
  } | null;
  const unreached = answer?.unreachedMentions;
  return {
    unreachedMentions: Array.isArray(unreached)
      ? unreached.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

/** Post, then refresh — the pattern every comment action shares. */
export async function sendComment(
  songId: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<false | CommentSent> {
  const sent = await sendTo(`${commentsUrl(songId)}${path}`, method, body);
  if (sent !== false) await refreshComments(songId);
  return sent;
}

function withReaction(
  reactions: readonly ReactionView[],
  reaction: Reaction,
  on: boolean,
  me: string,
): ReactionView[] {
  const existing = reactions.find((candidate) => candidate.reaction === reaction);
  if (on) {
    if (existing?.mine) return [...reactions];
    return existing === undefined
      ? [...reactions, { reaction, count: 1, mine: true, people: [me] }]
      : reactions.map((candidate) =>
          candidate === existing
            ? {
                ...existing,
                count: existing.count + 1,
                mine: true,
                people: [...existing.people, me],
              }
            : candidate,
        );
  }
  if (existing === undefined || !existing.mine) return [...reactions];
  const people = [...existing.people];
  const index = people.lastIndexOf(me);
  if (index >= 0) people.splice(index, 1);
  return existing.count <= 1
    ? reactions.filter((candidate) => candidate !== existing)
    : reactions.map((candidate) =>
        candidate === existing
          ? { ...existing, count: existing.count - 1, mine: false, people }
          : candidate,
      );
}

function replaceComment(
  data: CommentsData,
  commentId: string,
  change: (comment: CommentView) => CommentView,
): CommentsData {
  return {
    ...data,
    threads: data.threads.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) =>
        comment.id === commentId ? change(comment) : comment,
      ),
    })),
  };
}

/**
 * React, or take a reaction back (task `094`). Shown at once, then sent; if the server refuses,
 * this comment's reactions go back to what they were and the answer is `false`.
 */
export async function setReaction(
  songId: string,
  threadId: string,
  commentId: string,
  reaction: Reaction,
  on: boolean,
): Promise<boolean> {
  const entry = entryFor(songId);
  const before = entry.state;
  if (typeof before !== 'object') return false;
  const previous = before.threads
    .flatMap((thread) => thread.comments)
    .find((comment) => comment.id === commentId)?.reactions;
  const notify = () => {
    for (const listener of entry.listeners) listener();
  };
  entry.state = replaceComment(before, commentId, (comment) => ({
    ...comment,
    reactions: withReaction(comment.reactions ?? [], reaction, on, 'You'),
  }));
  notify();
  let ok = false;
  try {
    const response = await fetch(
      `${commentsUrl(songId)}/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}/reactions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reaction, on }),
      },
    );
    ok = response.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    // Roll back only this comment's reactions: anything else refreshed meanwhile stays.
    const now = entry.state;
    if (typeof now === 'object') {
      entry.state = replaceComment(now, commentId, (comment) => ({
        ...comment,
        reactions: previous ?? [],
      }));
      notify();
    }
    return false;
  }
  // The server's names and counts replace the optimistic "You".
  void refreshComments(songId);
  return true;
}
