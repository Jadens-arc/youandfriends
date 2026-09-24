/**
 * The player's state machine (task `070`).
 *
 * Pure: a state and an event in, a state out. No audio element, no timers, no fetch — the
 * controller in `store.ts` owns those and feeds this what happened. That is what lets every
 * transition be tested without a browser, and what keeps "what state are we in?" a question with
 * one answer rather than a guess assembled from an element's flags.
 *
 * `stalled` is its own state, not a kind of `loading`: loading is "we asked for a track and it
 * is not here yet"; stalled is "it was playing and the data stopped arriving". They get
 * different words on screen and different recovery (`docs/OPERATIONS.md` §9).
 */

export const PLAYER_STATUSES = [
  'idle',
  'loading',
  'ready',
  'playing',
  'paused',
  'seeking',
  'stalled',
  'ended',
  'error',
] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/**
 * Why playback stopped with an error. Each has its own recovery (`store.ts`): `network` retries
 * with backoff and on reconnect; `expired` fetches a fresh URL and resumes where it was; `decode`
 * stops — the same bytes will not decode on a second try; `unauthorized` stops and forgets the
 * URL; `not_ready` means the version is still processing.
 */
export type PlayerErrorKind =
  'network' | 'expired' | 'decode' | 'unauthorized' | 'not_ready' | 'unavailable';

export interface Track {
  /** The mix version (`mix_versions.id`) — what the stream endpoint authorizes. */
  readonly versionId: string;
  readonly songId: string;
  readonly title: string;
  readonly artist: string | null;
  /** "Version 3", shown beside the title. */
  readonly versionLabel: string;
}

export interface PlayerState {
  readonly status: PlayerStatus;
  readonly track: Track | null;
  /** What the listener asked for. Survives stalls, seeks and URL refreshes. */
  readonly wantsToPlay: boolean;
  readonly positionSeconds: number;
  readonly durationSeconds: number | null;
  readonly error: { readonly kind: PlayerErrorKind } | null;
  /** True while a fresh URL is being fetched and swapped in. Not a status: playback may continue. */
  readonly refreshing: boolean;
}

export type MediaEventName =
  | 'canplay'
  | 'playing'
  | 'pause'
  | 'waiting'
  | 'stalled'
  | 'seeking'
  | 'seeked'
  | 'ended'
  | 'timeupdate'
  | 'durationchange';

export type PlayerEvent =
  | { readonly type: 'load'; readonly track: Track; readonly autoplay: boolean }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'stop' }
  | { readonly type: 'seek'; readonly seconds: number }
  | {
      readonly type: 'media';
      readonly event: MediaEventName;
      readonly currentTime?: number;
      readonly duration?: number;
    }
  | { readonly type: 'failed'; readonly kind: PlayerErrorKind }
  | { readonly type: 'recovering' }
  /** The browser refused to start playback (autoplay policy): ready, but not playing. */
  | { readonly type: 'blocked' }
  | { readonly type: 'refresh'; readonly phase: 'start' | 'done' };

export const INITIAL_STATE: PlayerState = {
  status: 'idle',
  track: null,
  wantsToPlay: false,
  positionSeconds: 0,
  durationSeconds: null,
  error: null,
  refreshing: false,
};

/** Errors after which trying again with the same track is pointless or not allowed. */
const TERMINAL: readonly PlayerErrorKind[] = ['decode', 'unauthorized', 'not_ready', 'unavailable'];

export function isTerminal(kind: PlayerErrorKind): boolean {
  return TERMINAL.includes(kind);
}

export function transition(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case 'load':
      return {
        ...INITIAL_STATE,
        status: 'loading',
        track: event.track,
        wantsToPlay: event.autoplay,
      };
    case 'stop':
      return INITIAL_STATE;
    case 'play':
      if (state.track === null) return state;
      return {
        ...state,
        wantsToPlay: true,
        // Playing an ended track starts it again.
        positionSeconds: state.status === 'ended' ? 0 : state.positionSeconds,
      };
    case 'pause':
      return { ...state, wantsToPlay: false };
    case 'seek':
      if (state.track === null) return state;
      return { ...state, positionSeconds: Math.max(0, event.seconds) };
    case 'failed':
      return {
        ...state,
        status: 'error',
        error: { kind: event.kind },
        wantsToPlay: isTerminal(event.kind) ? false : state.wantsToPlay,
        refreshing: false,
      };
    case 'blocked':
      if (state.track === null) return state;
      return {
        ...state,
        wantsToPlay: false,
        status: state.status === 'playing' || state.status === 'ended' ? state.status : 'ready',
      };
    case 'recovering':
      if (state.track === null) return state;
      return { ...state, status: 'loading' };
    case 'refresh':
      return { ...state, refreshing: event.phase === 'start' };
    case 'media':
      return onMedia(state, event);
  }
}

function onMedia(state: PlayerState, event: Extract<PlayerEvent, { type: 'media' }>): PlayerState {
  if (state.track === null) return state;
  const position = event.currentTime ?? state.positionSeconds;
  const duration =
    event.duration !== undefined && Number.isFinite(event.duration) && event.duration > 0
      ? event.duration
      : state.durationSeconds;
  const next = { ...state, positionSeconds: position, durationSeconds: duration };

  switch (event.event) {
    case 'timeupdate':
    case 'durationchange':
      return next;
    case 'canplay':
      // Ready to play; whether it *is* playing is the `playing` event's to say.
      if (state.status === 'loading' || state.status === 'stalled') {
        return { ...next, status: state.wantsToPlay ? state.status : 'ready', error: null };
      }
      return next;
    case 'playing':
      return { ...next, status: 'playing', error: null };
    case 'pause':
      if (state.status === 'ended' || state.status === 'error') return next;
      return { ...next, status: state.status === 'loading' ? 'loading' : 'paused' };
    case 'waiting':
    case 'stalled':
      // Only a track that was playing can stall. Before it starts, it is still loading.
      return state.status === 'playing' || state.status === 'seeking'
        ? { ...next, status: 'stalled' }
        : next;
    case 'seeking':
      return state.status === 'loading' || state.status === 'error'
        ? next
        : { ...next, status: 'seeking' };
    case 'seeked':
      if (state.status !== 'seeking') return next;
      return { ...next, status: state.wantsToPlay ? 'playing' : 'paused' };
    case 'ended':
      return { ...next, status: 'ended', wantsToPlay: false };
  }
}
