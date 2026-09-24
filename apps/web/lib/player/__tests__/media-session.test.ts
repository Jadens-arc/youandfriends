import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaAdapter, MediaSnapshot } from '../audio-element';
import type { MediaEventName, Track } from '../machine';
import {
  artworkFor,
  connectMediaSession,
  type MediaActionDetails,
  type MediaSessionLike,
} from '../media-session';
import { createPlayer } from '../store';

vi.mock('@/components/library/personal', () => ({ recordPlay: vi.fn() }));

const TRACK: Track = {
  versionId: 'V1',
  songId: 'S1',
  title: 'Headlights',
  artist: 'Avery',
  versionLabel: 'Version 3',
  album: 'Night Drive',
  cover: {
    src: 'https://r2.example/c128',
    srcSet:
      'https://r2.example/c128 128w, https://r2.example/c256 256w, https://r2.example/c512 512w',
  },
};

class Media implements MediaAdapter {
  currentTime = 0;
  paused = true;
  errorCode = null;
  preservesPitch = true;
  private listener: ((event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) | null =
    null;
  setSource(_url: string, options: { startAt: number; play: boolean }) {
    this.currentTime = options.startAt;
    this.emit('durationchange');
    if (options.play) {
      this.paused = false;
      this.emit('playing');
    }
  }
  clearSource() {}
  async play() {
    this.paused = false;
    this.emit('playing');
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  seek(seconds: number) {
    this.currentTime = seconds;
    this.emit('seeked');
  }
  setVolume() {}
  setRate() {}
  subscribe(listener: (event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) {
    this.listener = listener;
    return () => undefined;
  }
  emit(event: MediaEventName | 'error') {
    this.listener?.(event, { currentTime: this.currentTime, duration: 187 });
  }
}

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  readonly handlers = new Map<string, ((details: MediaActionDetails) => void) | null>();
  readonly positions: { duration: number; position: number; playbackRate: number }[] = [];
  constructor(private readonly unsupported: readonly string[] = []) {}
  setActionHandler(action: string, handler: ((details: MediaActionDetails) => void) | null) {
    if (this.unsupported.includes(action)) throw new TypeError(`${action} is not supported`);
    this.handlers.set(action, handler);
  }
  setPositionState(state?: { duration: number; position: number; playbackRate: number }) {
    if (state !== undefined) this.positions.push(state);
  }
  act(action: string, details: MediaActionDetails = {}) {
    this.handlers.get(action)?.(details);
  }
}

class Metadata {
  constructor(readonly init: Record<string, unknown>) {}
}

describe('the Media Session (task 076)', () => {
  let media: Media;
  let session: FakeSession;

  function player() {
    const controller = createPlayer({
      fetchStreamUrl: async () => ({
        ok: true,
        grant: { url: 'https://r2.example/x', expiresAt: new Date(Date.now() + 900_000) },
      }),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    controller.attach(media);
    return controller;
  }

  beforeEach(() => {
    media = new Media();
    session = new FakeSession();
  });

  it('shows title, artist, project and every artwork size', async () => {
    const controller = player();
    connectMediaSession(controller, session, Metadata);
    await controller.load(TRACK);
    expect((session.metadata as Metadata).init).toEqual({
      title: 'Headlights',
      artist: 'Avery',
      album: 'Night Drive',
      artwork: [
        { src: 'https://r2.example/c128', sizes: '128x128', type: 'image/jpeg' },
        { src: 'https://r2.example/c256', sizes: '256x256', type: 'image/jpeg' },
        { src: 'https://r2.example/c512', sizes: '512x512', type: 'image/jpeg' },
      ],
    });
    expect(session.playbackState).toBe('playing');
  });

  it('answers play, pause, seek and skip from the system', async () => {
    const controller = player();
    connectMediaSession(controller, session, Metadata);
    await controller.load(TRACK);
    session.act('pause');
    expect(controller.getState().wantsToPlay).toBe(false);
    expect(session.playbackState).toBe('paused');
    session.act('play');
    expect(controller.getState().wantsToPlay).toBe(true);
    session.act('seekto', { seekTime: 100 });
    expect(media.currentTime).toBe(100);
    session.act('seekbackward', {});
    expect(media.currentTime).toBe(90);
    session.act('seekforward', { seekOffset: 30 });
    expect(media.currentTime).toBe(120);
    session.act('previoustrack');
    expect(media.currentTime).toBe(0);
  });

  it('keeps the system scrubber right after a seek and a speed change', async () => {
    const controller = player();
    connectMediaSession(controller, session, Metadata);
    await controller.load(TRACK);
    session.act('seekto', { seekTime: 60 });
    expect(session.positions.at(-1)).toEqual({ duration: 187, position: 60, playbackRate: 1 });
    controller.setRate(1.5);
    expect(session.positions.at(-1)).toMatchObject({ playbackRate: 1.5 });
  });

  it('offers next only when something is queued', async () => {
    const controller = player();
    connectMediaSession(controller, session, Metadata);
    await controller.load(TRACK);
    expect(session.handlers.get('nexttrack')).toBeNull();
    controller.queueLast([{ ...TRACK, versionId: 'V2' }]);
    expect(typeof session.handlers.get('nexttrack')).toBe('function');
  });

  it('feature-detects every action, surviving a browser that rejects some', async () => {
    session = new FakeSession(['seekto', 'stop', 'nexttrack']);
    const controller = player();
    expect(() => connectMediaSession(controller, session, Metadata)).not.toThrow();
    await controller.load(TRACK);
    expect(session.handlers.has('seekto')).toBe(false);
    expect(typeof session.handlers.get('play')).toBe('function');
  });

  it('does nothing without a media session, and cleans up after itself', async () => {
    const controller = player();
    expect(connectMediaSession(controller, undefined, Metadata)).toBeTypeOf('function');
    const disconnect = connectMediaSession(controller, session, Metadata);
    await controller.load(TRACK);
    disconnect();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(session.handlers.get('play')).toBeNull();
  });

  it('reads artwork sizes from the renditions, and offers none without a cover', () => {
    expect(artworkFor(null)).toEqual([]);
    expect(artworkFor({ srcSet: 'https://r2.example/a 256w' })).toEqual([
      { src: 'https://r2.example/a', sizes: '256x256', type: 'image/jpeg' },
    ]);
  });
});
