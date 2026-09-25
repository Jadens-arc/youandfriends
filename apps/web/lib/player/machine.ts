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
  /** The project's cover renditions (task `069`), or `null` for the placeholder. */
  readonly cover?: { readonly src: string; readonly srcSet: string } | null;
  /**
   * The project's name, for the lock screen's "album" line (task `076`) — only when the listener
   * can see the project; a song shared on its own does not name its hidden project.
   */
  readonly album?: string | null;
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
  /** 0–1. Survives loads and stops: it is the listener's setting, not the track's. */
  readonly volume: number;
  readonly muted: boolean;
  /** Loop the whole track (task `074`). */
  readonly loopTrack: boolean;
  /** This listener's loop on this song, in seconds, or `null`. Cleared by a new load. */
  readonly loopRegion: { readonly start: number; readonly end: number } | null;
  /** Playback rate, 0.5–2. Survives loads, like volume. */
  readonly rate: number;
  /**
   * The versions of the loaded song offered for A/B comparison (task `075`), newest first, with
   * the loudness that must be visible while comparing. `null` outside a song's page.
   */
  readonly comparison: readonly ComparisonTrack[] | null;
  /** The last *other* version that sounded, for the A/B key. */
  readonly lastOther: string | null;
  /** Said after a switch landed somewhere other than the same instant — a shorter version. */
  readonly switchNotice: string | null;
}

export interface ComparisonTrack extends Track {
  readonly durationSeconds: number | null;
  readonly integratedLufs: number | null;
  readonly truePeakDb: number | null;
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
  | {
      readonly type: 'load';
      readonly track: Track;
      readonly autoplay: boolean;
      /** Where to start, for a load that begins from a click on the waveform (task `072`). */
      readonly startAt?: number;
    }
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
  | { readonly type: 'refresh'; readonly phase: 'start' | 'done' }
  | { readonly type: 'volume'; readonly volume: number; readonly muted: boolean }
  | { readonly type: 'loop-track'; readonly on: boolean }
  | {
      readonly type: 'loop-region';
      readonly region: { readonly start: number; readonly end: number } | null;
    }
  | { readonly type: 'rate'; readonly rate: number }
  | { readonly type: 'comparison'; readonly versions: readonly ComparisonTrack[] | null }
  | {
      readonly type: 'switched';
      readonly track: Track;
      readonly from: string;
      readonly startAt: number;
      readonly notice: string | null;
    };

export const INITIAL_STATE: PlayerState = {
  status: 'idle',
  track: null,
  wantsToPlay: false,
  positionSeconds: 0,
  durationSeconds: null,
  error: null,
  refreshing: false,
  volume: 1,
  muted: false,
  loopTrack: false,
  loopRegion: null,
  rate: 1,
  comparison: null,
  lastOther: null,
  switchNotice: null,
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
        volume: state.volume,
        muted: state.muted,
        rate: state.rate,
        loopTrack: state.loopTrack,
        // The same song keeps its comparison set; another song's page will offer its own.
        comparison: state.track?.songId === event.track.songId ? state.comparison : null,
        status: 'loading',
        track: event.track,
        wantsToPlay: event.autoplay,
        positionSeconds: Math.max(0, event.startAt ?? 0),
      };
    case 'stop':
      return { ...INITIAL_STATE, volume: state.volume, muted: state.muted, rate: state.rate };
    case 'loop-track':
      return { ...state, loopTrack: event.on };
    case 'loop-region':
      return state.track === null ? state : { ...state, loopRegion: event.region };
    case 'comparison':
      return { ...state, comparison: event.versions };
    case 'switched':
      // A/B: same song, same instant, same wish to play — only the version changes. The loop
      // region is the song's, so it stays; the status follows from what the element does next.
      return {
        ...state,
        track: event.track,
        status: 'loading',
        positionSeconds: event.startAt,
        lastOther: event.from,
        switchNotice: event.notice,
        error: null,
      };
    case 'rate':
      return { ...state, rate: Math.min(2, Math.max(0.5, event.rate)) };
    case 'volume':
      return { ...state, volume: Math.min(1, Math.max(0, event.volume)), muted: event.muted };
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
