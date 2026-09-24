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
import { normalizeRegion, pastLoopEnd, withIn, withOut, type LoopRegionSeconds } from './loop';
import {
  addNext,
  addToEnd,
  advance,
  buildQueue,
  currentOf,
  cycleRepeat,
  EMPTY_QUEUE,
  fromPersisted,
  hasNext as queueHasNext,
  jumpTo,
  move,
  parsePersisted,
  removeAt,
  retreat,
  toggleShuffle,
  toPersisted,
  type PersistedQueue,
  type QueueState,
} from './queue';
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
  /**
   * Where the listener's volume is remembered between sessions (task `071`). A per-viewer
   * convenience — never the stream URL, which is never stored anywhere.
   */
  readonly volumeStorage?: VolumeStorage | undefined;
  /** Where the queue is remembered — version ids only, never URLs (task `073`). */
  readonly queueStorage?: QueueStorage | undefined;
  /**
   * Asks the server which of these versions this viewer may still play. A restored queue goes
   * through it before anything is shown or played. `null` when the answer could not be had.
   */
  readonly authorizeVersions?:
    ((versionIds: readonly string[]) => Promise<Track[] | null>) | undefined;
  readonly random?: () => number;
  /** This listener's loop region per song, on the server (task `074`). */
  readonly loopStorage?: LoopStorage | undefined;
  /** `requestAnimationFrame`, injectable so the loop boundary can be tested frame by frame. */
  readonly requestFrame?: (callback: () => void) => unknown;
  readonly cancelFrame?: (handle: unknown) => void;
}

export interface LoopStorage {
  read(songId: string): Promise<LoopRegionSeconds | null>;
  write(songId: string, region: LoopRegionSeconds | null): Promise<void>;
}

export interface QueueStorage {
  read(): unknown;
  write(value: PersistedQueue): void;
}

/** How close to the end the next track's URL is fetched and its bytes warmed (task `073`). */
export const PRELOAD_LEAD_SECONDS = 20;

export interface VolumeStorage {
  read(): { volume: number; muted: boolean } | null;
  write(value: { volume: number; muted: boolean }): void;
}

/** Previous restarts the track when more than this far in, like every player people know. */
export const RESTART_THRESHOLD_SECONDS = 3;

export interface PlayerController {
  getState(): PlayerState;
  subscribe(listener: () => void): () => void;
  attach(adapter: MediaAdapter): () => void;
  load(
    track: Track,
    options?: { readonly autoplay?: boolean; readonly startAt?: number },
  ): Promise<void>;
  /**
   * The element's own playhead, read now — for a playhead drawn every frame (task `072`). The
   * store's `positionSeconds` updates a few times a second, which is too coarse to draw from.
   */
  currentTime(): number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  stop(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  /** Restart, or — with a queue (task `073`) — go back a track. */
  previous(): void;
  /** The next queued track (task `073`). */
  next(): void;
  readonly hasNext: () => boolean;
  getQueue(): QueueState;
  /** Replace the queue with these tracks and play from `startAt`. */
  playQueue(tracks: readonly Track[], startAt?: number): Promise<void>;
  queueNext(tracks: readonly Track[]): void;
  queueLast(tracks: readonly Track[]): void;
  removeFromQueue(orderPosition: number): void;
  moveInQueue(from: number, to: number): void;
  playFromQueue(orderPosition: number): Promise<void>;
  cycleRepeat(): void;
  toggleShuffle(): void;
  clearQueue(): void;
  /** Bring back last session's queue, re-authorized. Plays nothing by itself. */
  restoreQueue(): Promise<void>;
  toggleLoopTrack(): void;
  /** Loop from the playhead. */
  setLoopIn(): void;
  /** Loop up to the playhead. */
  setLoopOut(): void;
  setLoopRegion(start: number, end: number): void;
  clearLoopRegion(): void;
  setRate(rate: number): void;
  /** Whether speed changes keep pitch in this browser (task `074`). */
  preservesPitch(): boolean;
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
  let queue: QueueState = EMPTY_QUEUE;
  /** The next track's URL, fetched — and so authorized — ahead of time, in memory only. */
  let preloaded: { versionId: string; grant: StreamUrl } | null = null;
  let preloading: string | null = null;
  const random = dependencies.random ?? Math.random;

  function dispatch(event: PlayerEvent) {
    const next = transition(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
    syncLoopWatcher();
  }

  const requestFrame =
    dependencies.requestFrame ??
    ((callback: () => void) =>
      typeof requestAnimationFrame === 'undefined' ? null : requestAnimationFrame(callback));
  const cancelFrame =
    dependencies.cancelFrame ??
    ((handle: unknown) => {
      if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(handle as number);
    });
  let loopFrame: unknown = null;

  /**
   * While a region loops and the track plays, check the boundary every animation frame — not on
   * `timeupdate`, which fires about four times a second and makes an audibly sloppy loop.
   */
  function syncLoopWatcher() {
    const active = state.loopRegion !== null && state.status === 'playing' && adapter !== null;
    if (!active) {
      if (loopFrame !== null) cancelFrame(loopFrame);
      loopFrame = null;
      return;
    }
    if (loopFrame !== null) return;
    const tick = () => {
      loopFrame = null;
      const region = state.loopRegion;
      if (region === null || state.status !== 'playing' || adapter === null) return;
      if (pastLoopEnd(adapter.currentTime, region)) adapter.seek(region.start);
      loopFrame = requestFrame(tick);
    };
    loopFrame = requestFrame(tick);
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

  function setQueue(next: QueueState) {
    queue = next;
    try {
      dependencies.queueStorage?.write(toPersisted(queue));
    } catch {
      // Storage refused: the queue still works for this session.
    }
    for (const listener of listeners) listener();
  }

  async function loadTrack(
    track: Track,
    options: { readonly autoplay?: boolean; readonly startAt?: number } = {},
  ) {
    loadToken += 1;
    const token = loadToken;
    clearTimers();
    grant = null;
    playReported = false;
    const startAt = Math.max(0, options.startAt ?? 0);
    dispatch({ type: 'load', track, autoplay: options.autoplay ?? true, startAt });
    void restoreLoop(track, token);
    // A URL fetched ahead of time for exactly this track is used as long as it has a while left;
    // it was authorized when it was fetched, moments ago.
    const ahead = preloaded;
    preloaded = null;
    const usable =
      ahead !== null &&
      ahead.versionId === track.versionId &&
      ahead.grant.expiresAt.getTime() - now() > REFRESH_LEAD_MS * 2;
    let fresh: StreamUrl | null;
    if (usable) {
      grant = ahead.grant;
      scheduleRefresh(token);
      fresh = ahead.grant;
    } else {
      fresh = await acquire(token);
    }
    if (fresh === null || adapter === null || token !== loadToken) return;
    adapter.setSource(fresh.url, {
      startAt,
      play: state.wantsToPlay,
      onPlayRejected: blocked,
    });
  }

  async function restoreLoop(track: Track, token: number) {
    let region: LoopRegionSeconds | null = null;
    try {
      region = (await dependencies.loopStorage?.read(track.songId)) ?? null;
    } catch {
      return; // A loop that could not be fetched is simply not restored.
    }
    if (token !== loadToken || region === null) return;
    dispatch({ type: 'loop-region', region });
  }

  function persistLoop(region: LoopRegionSeconds | null) {
    const track = state.track;
    if (track === null) return;
    void dependencies.loopStorage?.write(track.songId, region).catch(() => undefined);
  }

  function applyRegion(region: LoopRegionSeconds | null) {
    dispatch({ type: 'loop-region', region });
    persistLoop(region);
  }

  /** Play one track on its own: the queue becomes just this track. */
  async function load(
    track: Track,
    options: { readonly autoplay?: boolean; readonly startAt?: number } = {},
  ) {
    setQueue(buildQueue(queue, [track], 0, random));
    await loadTrack(track, options);
  }

  async function goTo(next: QueueState | null) {
    if (next === null) return false;
    setQueue(next);
    const track = currentOf(next);
    if (track !== null) await loadTrack(track, { autoplay: true });
    return true;
  }

  function onEnded() {
    // A whole-track loop, or a loop region reaching the very end of the file, starts again.
    const again = state.loopTrack ? 0 : state.loopRegion?.start;
    if (again !== undefined) {
      dispatch({ type: 'seek', seconds: again });
      adapter?.seek(again);
      play();
      return;
    }
    const next = advance(queue, 'auto');
    if (next === null) return;
    if (next.position === queue.position) {
      // Repeat one.
      dispatch({ type: 'seek', seconds: 0 });
      adapter?.seek(0);
      play();
      return;
    }
    void goTo(next);
  }

  /** Fetch — and so authorize — the next track's URL shortly before this one ends. */
  function maybePreload() {
    const duration = state.durationSeconds;
    if (duration === null || duration - state.positionSeconds > PRELOAD_LEAD_SECONDS) return;
    const nextQueue = advance(queue, 'auto');
    const next = nextQueue === null ? null : currentOf(nextQueue);
    if (next === null || next.versionId === state.track?.versionId) return;
    if (preloaded?.versionId === next.versionId || preloading === next.versionId) return;
    preloading = next.versionId;
    void fetchUrl(next.versionId).then((result) => {
      preloading = null;
      if (!result.ok) return; // Found out properly, with its own error, when it is loaded.
      preloaded = { versionId: next.versionId, grant: result.grant };
      // Warm the bytes without a second element taking audio focus (`docs/OPERATIONS.md` §9).
      adapter?.preload?.(result.grant.url);
    });
  }

  function play() {
    const track = state.track;
    if (track === null) {
      // A restored queue loads nothing until the listener asks for it.
      const queued = currentOf(queue);
      if (queued !== null) void loadTrack(queued, { autoplay: true });
      return;
    }
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

  function applyVolume(volume: number, muted: boolean) {
    dispatch({ type: 'volume', volume, muted });
    adapter?.setVolume(state.volume, state.muted);
    try {
      dependencies.volumeStorage?.write({ volume: state.volume, muted: state.muted });
    } catch {
      // Private mode or blocked storage: the setting holds for this session and that is fine.
    }
  }

  try {
    const saved = dependencies.volumeStorage?.read() ?? null;
    if (saved !== null) dispatch({ type: 'volume', volume: saved.volume, muted: saved.muted });
  } catch {
    // Unreadable storage is the same as nothing saved.
  }

  function attach(next: MediaAdapter) {
    adapter = next;
    next.setVolume(state.volume, state.muted);
    next.setRate(state.rate);
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
      if (event === 'timeupdate') maybePreload();
      if (event === 'ended') onEnded();
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
    currentTime: () => adapter?.currentTime ?? state.positionSeconds,
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
    setVolume(volume) {
      applyVolume(volume, volume === 0 ? state.muted : false);
    },
    toggleMute() {
      applyVolume(state.volume, !state.muted);
    },
    previous() {
      if (state.track === null) return;
      const restart = () => {
        dispatch({ type: 'seek', seconds: 0 });
        adapter?.seek(0);
      };
      if ((adapter?.currentTime ?? state.positionSeconds) > RESTART_THRESHOLD_SECONDS) {
        restart();
        return;
      }
      const previousQueue = retreat(queue);
      if (previousQueue === null) restart();
      else void goTo(previousQueue);
    },
    next() {
      void goTo(advance(queue, 'next'));
    },
    hasNext: () => queueHasNext(queue),
    getQueue: () => queue,
    async playQueue(tracks, startAt = 0) {
      if (tracks.length === 0) return;
      await goTo(buildQueue(queue, tracks, startAt, random));
    },
    queueNext(tracks) {
      const wasEmpty = queue.items.length === 0;
      setQueue(addNext(queue, tracks));
      if (wasEmpty && state.track === null) void goTo(queue);
    },
    queueLast(tracks) {
      const wasEmpty = queue.items.length === 0;
      setQueue(addToEnd(queue, tracks));
      if (wasEmpty && state.track === null) void goTo(queue);
    },
    removeFromQueue(orderPosition) {
      const removingCurrent = orderPosition === queue.position;
      const next = removeAt(queue, orderPosition);
      setQueue(next);
      if (!removingCurrent) return;
      const track = currentOf(next);
      if (track === null) {
        loadToken += 1;
        clearTimers();
        grant = null;
        adapter?.clearSource();
        dispatch({ type: 'stop' });
      } else {
        void loadTrack(track, { autoplay: state.wantsToPlay });
      }
    },
    moveInQueue(from, to) {
      setQueue(move(queue, from, to));
    },
    async playFromQueue(orderPosition) {
      await goTo(jumpTo(queue, orderPosition));
    },
    cycleRepeat() {
      setQueue(cycleRepeat(queue));
    },
    toggleShuffle() {
      setQueue(toggleShuffle(queue, random));
    },
    clearQueue() {
      // Everything but what is playing.
      const track = currentOf(queue);
      setQueue(
        track === null
          ? { ...EMPTY_QUEUE, repeat: queue.repeat, shuffle: queue.shuffle }
          : buildQueue({ ...queue, shuffle: false }, [track]),
      );
    },
    toggleLoopTrack() {
      dispatch({ type: 'loop-track', on: !state.loopTrack });
    },
    setLoopIn() {
      if (state.track === null) return;
      applyRegion(
        withIn(
          state.loopRegion,
          adapter?.currentTime ?? state.positionSeconds,
          state.durationSeconds,
        ),
      );
    },
    setLoopOut() {
      if (state.track === null) return;
      applyRegion(
        withOut(
          state.loopRegion,
          adapter?.currentTime ?? state.positionSeconds,
          state.durationSeconds,
        ),
      );
    },
    setLoopRegion(start, end) {
      if (state.track === null) return;
      applyRegion(normalizeRegion(start, end, state.durationSeconds));
    },
    clearLoopRegion() {
      if (state.loopRegion === null) return;
      applyRegion(null);
    },
    setRate(rate) {
      dispatch({ type: 'rate', rate });
      adapter?.setRate(state.rate);
    },
    preservesPitch: () => adapter?.preservesPitch ?? true,
    async restoreQueue() {
      let stored: PersistedQueue | null = null;
      try {
        stored = parsePersisted(dependencies.queueStorage?.read() ?? null);
      } catch {
        stored = null;
      }
      if (stored === null || stored.versionIds.length === 0) return;
      // Never shown or played from storage: the server says what this viewer may still play.
      const permitted = await dependencies.authorizeVersions?.(stored.versionIds);
      if (permitted === null || permitted === undefined) return;
      if (queue.items.length > 0) return; // Something was queued while we asked.
      setQueue(fromPersisted(stored, permitted));
    },
  };
}

const VOLUME_KEY = 'youandfriends.player.volume';

const localVolumeStorage: VolumeStorage = {
  read() {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
    if (typeof parsed.volume !== 'number' || typeof parsed.muted !== 'boolean') return null;
    return { volume: parsed.volume, muted: parsed.muted };
  },
  write(value) {
    window.localStorage.setItem(VOLUME_KEY, JSON.stringify(value));
  },
};

const QUEUE_KEY = 'youandfriends.player.queue';

const localQueueStorage: QueueStorage = {
  read() {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  },
  write(value) {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(value));
  },
};

async function authorizeVersions(versionIds: readonly string[]): Promise<Track[] | null> {
  try {
    const response = await fetch('/api/queue/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'versions', versionIds }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tracks?: Track[] };
    return Array.isArray(body.tracks) ? body.tracks : null;
  } catch {
    return null;
  }
}

/** Loop regions live on the server, per user per song (task `074`), in whole milliseconds. */
const serverLoopStorage: LoopStorage = {
  async read(songId) {
    const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/loop`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { region?: { startMs: number; endMs: number } | null };
    return body.region === null || body.region === undefined
      ? null
      : { start: body.region.startMs / 1000, end: body.region.endMs / 1000 };
  },
  async write(songId, region) {
    const path = `/api/songs/${encodeURIComponent(songId)}/loop`;
    await fetch(path, {
      method: region === null ? 'DELETE' : 'PUT',
      headers: { 'content-type': 'application/json' },
      ...(region === null
        ? {}
        : {
            body: JSON.stringify({
              startMs: Math.round(region.start * 1000),
              endMs: Math.round(region.end * 1000),
            }),
          }),
    });
  },
};

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
      volumeStorage: localVolumeStorage,
      queueStorage: localQueueStorage,
      authorizeVersions,
      loopStorage: serverLoopStorage,
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

/** The queue, anywhere in the tree (task `073`). */
export function useQueueState(): QueueState {
  return React.useSyncExternalStore(
    (listener) => getPlayer().subscribe(listener),
    () => getPlayer().getQueue(),
    () => EMPTY_QUEUE,
  );
}
