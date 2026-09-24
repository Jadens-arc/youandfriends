import type { MediaEventName } from './machine';

/**
 * What the player's controller needs from a media element (task `070`) — narrow, so the
 * controller is tested against a fake and this adapter against a real `<audio>`.
 *
 * Native `<audio>`, deliberately, not a Web Audio graph: it is what gets Media Session, lock-screen
 * controls, AirPlay and background playback on iOS (ADR 0004, `docs/OPERATIONS.md` §9). And one
 * element, always — two fight over Media Session and over iOS's single audio focus.
 */
export interface MediaAdapter {
  /**
   * Point the element at a new URL and, once its metadata is in, restore `startAt` and resume if
   * `play` — how a URL refresh keeps the playhead and the playing state.
   */
  setSource(
    url: string,
    options: {
      readonly startAt: number;
      readonly play: boolean;
      /** The browser refused to play (autoplay policy, no user gesture). */
      readonly onPlayRejected?: () => void;
    },
  ): void;
  clearSource(): void;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number, muted: boolean): void;
  /** Speed, with pitch preserved where the browser can (task `074`). */
  setRate(rate: number): void;
  /** Whether this browser keeps pitch when speed changes. Said, not assumed. */
  readonly preservesPitch: boolean;
  /**
   * Warm the next track's bytes (task `073`) in a detached element that is never played, so it
   * never takes audio focus — the one element that plays stays the only one.
   */
  preload?(url: string): void;
  readonly currentTime: number;
  readonly paused: boolean;
  /** `MediaError.code` of the last error, or `null`. */
  readonly errorCode: number | null;
  subscribe(
    listener: (event: MediaEventName | 'error', element: MediaSnapshot) => void,
  ): () => void;
}

export interface MediaSnapshot {
  readonly currentTime: number;
  readonly duration: number;
}

/** `MediaError` codes, named. jsdom does not define the constants. */
export const MEDIA_ERR = { ABORTED: 1, NETWORK: 2, DECODE: 3, SRC_NOT_SUPPORTED: 4 } as const;

const EVENTS: readonly (MediaEventName | 'error')[] = [
  'canplay',
  'playing',
  'pause',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'ended',
  'timeupdate',
  'durationchange',
  'error',
];

export function createAudioElementAdapter(element: HTMLAudioElement): MediaAdapter {
  element.preload = 'auto';
  let pendingRestore: (() => void) | null = null;
  let warm: HTMLAudioElement | null = null;

  return {
    setSource(url, { startAt, play, onPlayRejected }) {
      if (pendingRestore !== null) element.removeEventListener('loadedmetadata', pendingRestore);
      const rate = element.playbackRate;
      const restore = () => {
        element.removeEventListener('loadedmetadata', restore);
        pendingRestore = null;
        // A new source resets the rate on some engines; the listener's speed carries over.
        element.playbackRate = rate;
        if (startAt > 0) element.currentTime = startAt;
        if (play) void element.play().catch(() => onPlayRejected?.());
      };
      pendingRestore = restore;
      element.addEventListener('loadedmetadata', restore);
      element.src = url;
      element.load();
    },
    clearSource() {
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
    play: () => element.play(),
    pause: () => element.pause(),
    seek(seconds) {
      element.currentTime = seconds;
    },
    setVolume(volume, muted) {
      element.volume = volume;
      element.muted = muted;
    },
    setRate(rate) {
      const pitched = element as HTMLAudioElement & {
        preservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
        mozPreservesPitch?: boolean;
      };
      pitched.preservesPitch = true;
      pitched.webkitPreservesPitch = true;
      pitched.mozPreservesPitch = true;
      element.playbackRate = rate;
    },
    get preservesPitch() {
      return (
        'preservesPitch' in element ||
        'webkitPreservesPitch' in element ||
        'mozPreservesPitch' in element
      );
    },
    preload(url) {
      warm ??= new Audio();
      warm.preload = 'auto';
      warm.muted = true;
      warm.src = url;
      warm.load();
    },
    get currentTime() {
      return element.currentTime;
    },
    get paused() {
      return element.paused;
    },
    get errorCode() {
      return element.error?.code ?? null;
    },
    subscribe(listener) {
      const handlers = EVENTS.map((name) => {
        const handler = () =>
          listener(name, { currentTime: element.currentTime, duration: element.duration });
        element.addEventListener(name, handler);
        return [name, handler] as const;
      });
      return () => {
        for (const [name, handler] of handlers) element.removeEventListener(name, handler);
      };
    },
  };
}
