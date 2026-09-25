import type { PlayerState } from './machine';
import type { PlayerController } from './store';

/**
 * The lock screen, Control Centre, headphones and keyboards' media keys (task `076`), through the
 * Media Session API.
 *
 * This works — including in the background on iOS — because task `070` plays through one native
 * `<audio>` element, not a Web Audio graph (ADR 0004, `docs/OPERATIONS.md` §9).
 *
 * **Privacy, accepted:** metadata goes to the operating system, which may show an unreleased
 * song's title and artwork on a locked phone that others can see. That is what the feature is,
 * and it is noted in `docs/OPERATIONS.md` §9.
 */

/** How far the system's "skip back" and "skip forward" go when they do not say. */
export const DEFAULT_SEEK_OFFSET_SECONDS = 10;

/** The subset of `navigator.mediaSession` used here, so a test can supply its own. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: string, handler: ((details: MediaActionDetails) => void) | null): void;
  setPositionState?(state?: { duration: number; position: number; playbackRate: number }): void;
}

export interface MediaActionDetails {
  readonly action?: string;
  readonly seekOffset?: number;
  readonly seekTime?: number;
  readonly fastSeek?: boolean;
}

type MetadataConstructor = new (init: {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes: string; type: string }[];
}) => unknown;

/**
 * The artwork list for the platform: every rendition we have, each declared at its real size, so
 * the system picks the one it wants rather than ignoring a single large image.
 */
export function artworkFor(
  cover: { readonly srcSet: string } | null | undefined,
): { src: string; sizes: string; type: string }[] {
  if (cover === null || cover === undefined || cover.srcSet === '') return [];
  return cover.srcSet.split(', ').flatMap((entry) => {
    const [src, width] = entry.trim().split(/\s+/);
    const pixels = width?.endsWith('w') ? Number.parseInt(width, 10) : Number.NaN;
    if (src === undefined || !Number.isFinite(pixels)) return [];
    return [{ src, sizes: `${pixels}x${pixels}`, type: 'image/jpeg' }];
  });
}

/**
 * Connect a player to a media session. Returns a function that disconnects it. Does nothing where
 * the browser has no media session.
 */
export function connectMediaSession(
  player: PlayerController,
  session: MediaSessionLike | undefined,
  Metadata: MetadataConstructor | undefined,
): () => void {
  if (session === undefined || Metadata === undefined) return () => undefined;

  /** Actions this browser accepted. Registering an unsupported one throws on some browsers. */
  const supported = new Set<string>();
  const handle = (action: string, handler: ((details: MediaActionDetails) => void) | null) => {
    try {
      session.setActionHandler(action, handler);
      if (handler !== null) supported.add(action);
    } catch {
      // Not supported here; the system simply does not show that control.
    }
  };

  const seekBy = (offset: number) => {
    const state = player.getState();
    const duration = state.durationSeconds ?? Number.POSITIVE_INFINITY;
    player.seek(Math.min(duration, Math.max(0, player.currentTime() + offset)));
  };

  handle('play', () => player.play());
  handle('pause', () => player.pause());
  handle('stop', () => player.pause());
  handle('previoustrack', () => player.previous());
  handle('seekbackward', (details) => seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS)));
  handle('seekforward', (details) => seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS));
  handle('seekto', (details) => {
    if (details.seekTime !== undefined) player.seek(details.seekTime);
  });

  let lastTrack: string | null = null;
  let lastPosition: string | null = null;
  let nextOffered: boolean | null = null;

  const sync = (state: PlayerState) => {
    const track = state.track;
    // Metadata, when the track (or its version) changes.
    const trackKey = track === null ? null : `${track.versionId}|${track.cover?.srcSet ?? ''}`;
    if (trackKey !== lastTrack) {
      lastTrack = trackKey;
      session.metadata =
        track === null
          ? null
          : new Metadata({
              title: track.title,
              artist: track.artist ?? '',
              album: track.album ?? track.versionLabel,
              artwork: artworkFor(track.cover),
            });
    }

    session.playbackState =
      track === null
        ? 'none'
        : state.wantsToPlay && state.status === 'playing'
          ? 'playing'
          : 'paused';

    // "Next" only when there is a next — a button that does nothing on a lock screen feels broken.
    const hasNext = player.hasNext();
    if (hasNext !== nextOffered) {
      nextOffered = hasNext;
      handle('nexttrack', hasNext ? () => player.next() : null);
    }

    // Position, whenever the duration, the rate, or a seek changes it — not every timeupdate:
    // the system extrapolates from position and rate, and needs telling only when either jumps.
    const duration = state.durationSeconds;
    if (session.setPositionState !== undefined && track !== null && duration !== null) {
      const position = Math.min(duration, Math.max(0, player.currentTime()));
      const key = `${track.versionId}|${duration}|${state.rate}|${state.status}|${Math.round(position)}`;
      if (key !== lastPosition) {
        lastPosition = key;
        try {
          session.setPositionState({ duration, position, playbackRate: state.rate });
        } catch {
          // A position the platform rejects (e.g. a duration it cannot represent) is skipped.
        }
      }
    }
  };

  sync(player.getState());
  const unsubscribe = player.subscribe(() => sync(player.getState()));
  return () => {
    unsubscribe();
    for (const action of supported) handle(action, null);
    session.metadata = null;
    session.playbackState = 'none';
  };
}
