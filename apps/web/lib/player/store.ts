import * as React from 'react';

import { recordPlay } from '@/components/library/personal';

import type { MediaAdapter } from './audio-element';
import { MEDIA_ERR } from './audio-element';
import {
  INITIAL_STATE,
  isTerminal,
  transition,
  type PlayerErrorKind,
  type PlayerEvent,
  type PlayerState,
  type Track,
} from './machine';
import { fetchStreamUrl, type FetchStreamUrl, type StreamUrl } from './stream-url';

/**
 * The global player (task `070`): one controller, one `<audio>` element, one store any component
 * can read without props being threaded through the tree.
 *
 * The controller owns everything with a lifetime — the stream URL and its expiry, the refresh
 * timer, the network retry — and reports what happened to the pure machine in `machine.ts`.
 *
 * **Stream URLs expire** (15 minutes, task `050`). Before one does, the controller fetches a new
 * one — which re-checks authorization, so revoked access stops playback here — captures the
 * playhead and whether it was playing, swaps the source, and restores both. A listener never
 * sees a mid-song failure for an expiry.
 */

/** How long before expiry a URL is replaced. */
export const REFRESH_LEAD_MS = 60_000;
/** Network retries back off from here to {@link NETWORK_RETRY_MAX_MS}. */
export const NETWORK_RETRY_INITIAL_MS = 1_000;
export const NETWORK_RETRY_MAX_MS = 30_000;

export interface PlayerDependencies {
  readonly fetchStreamUrl?: FetchStreamUrl;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Called once per load, when the track first actually plays (task `044`'s recents). */
  readonly onPlayStarted?: (track: Track) => void;
  /** Subscribes to the browser coming back online. */
  readonly onOnline?: (callback: () => void) => () => void;
}

export interface PlayerController {
  getState(): PlayerState;
  subscribe(listener: () => void): () => void;
  attach(adapter: MediaAdapter): () => void;
  load(track: Track, options?: { readonly autoplay?: boolean }): Promise<void>;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  stop(): void;
}

export function createPlayer(dependencies: PlayerDependencies = {}): PlayerController {
  const fetchUrl = dependencies.fetchStreamUrl ?? fetchStreamUrl;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    dependencies.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: PlayerState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  let adapter: MediaAdapter | null = null;
  /** In memory only, for as long as it is valid. Never persisted, never logged. */
  let grant: StreamUrl | null = null;
  let refreshTimer: unknown = null;
  let retryTimer: unknown = null;
  let retryDelay = NETWORK_RETRY_INITIAL_MS;
  let loadToken = 0;
  let playReported = false;

  function dispatch(event: PlayerEvent) {
    const next = transition(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function clearTimers() {
    if (refreshTimer !== null) clearTimer(refreshTimer);
    if (retryTimer !== null) clearTimer(retryTimer);
    refreshTimer = null;
    retryTimer = null;
  }

  function scheduleRefresh(token: number) {
    if (grant === null) return;
    if (refreshTimer !== null) clearTimer(refreshTimer);
    const delay = Math.max(5_000, grant.expiresAt.getTime() - now() - REFRESH_LEAD_MS);
    refreshTimer = setTimer(() => {
      refreshTimer = null;
      void refresh(token);
    }, delay);
  }

  function blocked() {
    dispatch({ type: 'blocked' });
  }

  /** Stop and forget the URL, for an error no retry will fix. */
  function fail(kind: PlayerErrorKind) {
    clearTimers();
    if (isTerminal(kind)) {
      grant = null;
      adapter?.clearSource();
    }
    dispatch({ type: 'failed', kind });
  }

  async function acquire(token: number): Promise<StreamUrl | null> {
    const track = state.track;
    if (track === null) return null;
    const result = await fetchUrl(track.versionId);
    if (token !== loadToken) return null; // A newer load superseded this one.
    if (!result.ok) {
      fail(result.kind);
      if (result.kind === 'network') scheduleRetry(token);
      return null;
    }
    grant = result.grant;
    retryDelay = NETWORK_RETRY_INITIAL_MS;
    scheduleRefresh(token);
    return result.grant;
  }

  /**
   * Replace the URL, keeping the playhead and the playing state. Used before expiry, after an
   * expired URL was rejected, and to recover from a network failure.
   */
  async function refresh(token: number) {
    if (adapter === null || state.track === null) return;
    dispatch({ type: 'refresh', phase: 'start' });
    const fresh = await acquire(token);
    if (fresh === null || token !== loadToken || adapter === null) return;
    // Read *after* the fetch: the old URL kept playing while the new one was requested, and the
    // swap should resume from where the listener is now, not from where they were a moment ago.
    const startAt = adapter.currentTime;
    const resume = state.wantsToPlay;
    adapter.setSource(fresh.url, { startAt, play: resume, onPlayRejected: blocked });
    dispatch({ type: 'refresh', phase: 'done' });
  }

  function scheduleRetry(token: number) {
    if (retryTimer !== null) clearTimer(retryTimer);
    const delay = retryDelay;
    retryDelay = Math.min(NETWORK_RETRY_MAX_MS, retryDelay * 2);
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (token !== loadToken || state.error?.kind !== 'network') return;
      dispatch({ type: 'recovering' });
      void refresh(token);
    }, delay);
  }

  /**
   * An element error, sorted into its recovery path. The element only says "network" or
   * "unsupported"; whether that means the URL expired is known here, from its expiry.
   */
  function onMediaError() {
    if (adapter === null) return;
    const code = adapter.errorCode;
    const token = loadToken;
    const expired = grant !== null && now() >= grant.expiresAt.getTime() - 5_000;
    if (expired && (code === MEDIA_ERR.NETWORK || code === MEDIA_ERR.SRC_NOT_SUPPORTED)) {
      // Expired: a fresh URL, same place. Not an error the listener needs to see.
      void refresh(token);
      return;
    }
    if (code === MEDIA_ERR.NETWORK) {
      fail('network');
      scheduleRetry(token);
      return;
    }
    if (code === MEDIA_ERR.ABORTED) return; // A source swap aborts the old fetch; expected.
    fail('decode');
  }

  async function load(track: Track, options: { readonly autoplay?: boolean } = {}) {
    loadToken += 1;
    const token = loadToken;
    clearTimers();
    grant = null;
    playReported = false;
    dispatch({ type: 'load', track, autoplay: options.autoplay ?? true });
    const fresh = await acquire(token);
    if (fresh === null || adapter === null || token !== loadToken) return;
    adapter.setSource(fresh.url, {
      startAt: 0,
      play: state.wantsToPlay,
      onPlayRejected: blocked,
    });
  }

  function play() {
    const track = state.track;
    if (track === null) return;
    const failed = state.status === 'error' ? state.error : null;
    dispatch({ type: 'play' });
    if (failed !== null) {
      if (isTerminal(failed.kind)) {
        // Start over: a fresh authorization and a fresh URL. If the reason still holds, the
        // same error comes back, honestly.
        void load(track, { autoplay: true });
      } else {
        dispatch({ type: 'recovering' });
        void refresh(loadToken);
      }
      return;
    }
    if (state.positionSeconds === 0 && adapter !== null && adapter.currentTime > 0) {
      adapter.seek(0);
    }
    void adapter?.play().catch(blocked);
  }

  function pause() {
    dispatch({ type: 'pause' });
    adapter?.pause();
  }

  function attach(next: MediaAdapter) {
    adapter = next;
    const unsubscribe = next.subscribe((event, snapshot) => {
      if (event === 'error') {
        onMediaError();
        return;
      }
      dispatch({
        type: 'media',
        event,
        currentTime: snapshot.currentTime,
        duration: snapshot.duration,
      });
      if (event === 'playing' && !playReported && state.track !== null) {
        playReported = true;
        dependencies.onPlayStarted?.(state.track);
      }
    });
    const unsubscribeOnline =
      dependencies.onOnline?.(() => {
        if (state.error?.kind !== 'network') return;
        if (retryTimer !== null) clearTimer(retryTimer);
        retryTimer = null;
        retryDelay = NETWORK_RETRY_INITIAL_MS;
        dispatch({ type: 'recovering' });
        void refresh(loadToken);
      }) ?? null;
    return () => {
      unsubscribe();
      unsubscribeOnline?.();
      if (adapter === next) adapter = null;
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach,
    load,
    play,
    pause,
    toggle() {
      if (state.wantsToPlay) pause();
      else play();
    },
    seek(seconds) {
      dispatch({ type: 'seek', seconds });
      adapter?.seek(Math.max(0, seconds));
    },
    stop() {
      loadToken += 1;
      clearTimers();
      grant = null;
      adapter?.clearSource();
      dispatch({ type: 'stop' });
    },
  };
}

let singleton: PlayerController | null = null;

/** The app's one player. Created on first use in the browser; the shell attaches the element. */
export function getPlayer(): PlayerController {
  if (singleton === null) {
    singleton = createPlayer({
      onPlayStarted: (track) => recordPlay(track.songId),
      onOnline: (callback) => {
        window.addEventListener('online', callback);
        return () => window.removeEventListener('online', callback);
      },
    });
  }
  return singleton;
}

/** The player's state, anywhere in the tree. */
export function usePlayerState(): PlayerState {
  return React.useSyncExternalStore(
    (listener) => getPlayer().subscribe(listener),
    () => getPlayer().getState(),
    () => INITIAL_STATE,
  );
}
