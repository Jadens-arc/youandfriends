import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MEDIA_ERR, type MediaAdapter, type MediaSnapshot } from '../audio-element';
import type { MediaEventName, Track } from '../machine';
import { createPlayer, NETWORK_RETRY_INITIAL_MS, REFRESH_LEAD_MS } from '../store';
import type { StreamUrlResult } from '../stream-url';

vi.mock('@/components/library/personal', () => ({ recordPlay: vi.fn() }));

const TRACK: Track = {
  versionId: 'V1',
  songId: 'S1',
  title: 'Headlights',
  artist: null,
  versionLabel: 'Version 1',
};

/**
 * A media element that behaves like one for the controller: it has a source, a playhead, a paused
 * flag and an error code, and it emits events when told to. The real element is exercised by
 * `audio-element.test.ts`; this is what lets the controller's timing be tested exactly.
 */
class FakeMedia implements MediaAdapter {
  src: string | null = null;
  currentTime = 0;
  paused = true;
  errorCode: number | null = null;
  playRejects = false;
  readonly sources: { url: string; startAt: number; play: boolean }[] = [];
  private listener: ((event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) | null =
    null;

  setSource(url: string, options: { startAt: number; play: boolean; onPlayRejected?: () => void }) {
    this.src = url;
    this.sources.push({ url, startAt: options.startAt, play: options.play });
    this.errorCode = null;
    this.currentTime = options.startAt;
    this.emit('canplay');
    if (options.play) {
      if (this.playRejects) options.onPlayRejected?.();
      else {
        this.paused = false;
        this.emit('playing');
      }
    }
  }
  clearSource() {
    this.src = null;
    this.paused = true;
  }
  async play() {
    if (this.playRejects) throw new Error('NotAllowedError');
    this.paused = false;
    this.emit('playing');
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  seek(seconds: number) {
    this.currentTime = seconds;
  }
  volume = 1;
  muted = false;
  preload?: (url: string) => void;
  rate = 1;
  preservesPitch = true;
  setRate(rate: number) {
    this.rate = rate;
  }
  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
  }
  subscribe(listener: (event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  emit(event: MediaEventName | 'error') {
    this.listener?.(event, { currentTime: this.currentTime, duration: 187 });
  }
  fail(code: number) {
    this.errorCode = code;
    this.emit('error');
  }
}

describe('the player controller (task 070)', () => {
  let clock: number;
  let timers: { at: number; callback: () => void; id: number }[];
  let nextId: number;
  let grants: StreamUrlResult[];
  let requested: string[];
  let media: FakeMedia;
  let online: (() => void) | null;
  let started: Track[];

  function advance(ms: number) {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (due === undefined || due.at > target) break;
      timers.shift();
      clock = due.at;
      due.callback();
    }
    clock = target;
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function grant(url: string, ttlMs = 15 * 60_000): StreamUrlResult {
    return { ok: true, grant: { url, expiresAt: new Date(clock + ttlMs) } };
  }

  function player() {
    const controller = createPlayer({
      now: () => clock,
      setTimer: (callback, ms) => {
        nextId += 1;
        timers.push({ at: clock + ms, callback, id: nextId });
        return nextId;
      },
      clearTimer: (handle) => {
        timers = timers.filter((timer) => timer.id !== handle);
      },
      fetchStreamUrl: async (versionId) => {
        requested.push(versionId);
        const next = grants.shift();
        if (next === undefined) throw new Error('no grant queued');
        return next;
      },
      onOnline: (callback) => {
        online = callback;
        return () => {
          online = null;
        };
      },
      onPlayStarted: (track) => started.push(track),
    });
    controller.attach(media);
    return controller;
  }

  beforeEach(() => {
    clock = 1_000_000;
    timers = [];
    nextId = 0;
    grants = [];
    requested = [];
    media = new FakeMedia();
    online = null;
    started = [];
  });

  it('loads a track through the authorized endpoint and plays it', async () => {
    grants.push(grant('https://r2.example/one'));
    const controller = player();
    await controller.load(TRACK);
    expect(requested).toEqual(['V1']);
    expect(media.sources).toEqual([{ url: 'https://r2.example/one', startAt: 0, play: true }]);
    expect(controller.getState()).toMatchObject({ status: 'playing', track: TRACK });
    expect(started).toEqual([TRACK]);
  });

  it('refreshes the URL before it expires, keeping the playhead and playing state', async () => {
    grants.push(grant('https://r2.example/one'), grant('https://r2.example/two'));
    const controller = player();
    await controller.load(TRACK);
    media.currentTime = 612.5;

    advance(15 * 60_000 - REFRESH_LEAD_MS - 1);
    expect(requested).toHaveLength(1);
    advance(1);
    await flush();

    expect(requested).toEqual(['V1', 'V1']);
    expect(media.sources.at(-1)).toEqual({
      url: 'https://r2.example/two',
      startAt: 612.5,
      play: true,
    });
    expect(controller.getState()).toMatchObject({
      status: 'playing',
      refreshing: false,
      error: null,
    });
    // One play counted, not one per URL.
    expect(started).toHaveLength(1);
  });

  it('keeps a paused track paused across a refresh', async () => {
    grants.push(grant('https://r2.example/one'), grant('https://r2.example/two'));
    const controller = player();
    await controller.load(TRACK);
    controller.pause();
    media.currentTime = 30;
    advance(15 * 60_000);
    await flush();
    expect(media.sources.at(-1)).toEqual({
      url: 'https://r2.example/two',
      startAt: 30,
      play: false,
    });
    expect(controller.getState()).toMatchObject({ status: 'paused', wantsToPlay: false });
  });

  it('stops playback when authorization is revoked, discovered at the next refresh', async () => {
    grants.push(grant('https://r2.example/one'), { ok: false, kind: 'unauthorized' });
    const controller = player();
    await controller.load(TRACK);
    advance(15 * 60_000);
    await flush();
    expect(controller.getState()).toMatchObject({
      status: 'error',
      error: { kind: 'unauthorized' },
      wantsToPlay: false,
    });
    expect(media.src).toBeNull();
    // Nothing further is scheduled for a track the listener may no longer hear.
    expect(timers).toEqual([]);
  });

  it('recovers from an expired URL by fetching a fresh one, silently', async () => {
    grants.push(grant('https://r2.example/one', 60_000), grant('https://r2.example/two'));
    const controller = player();
    await controller.load(TRACK);
    media.currentTime = 50;
    // The proactive refresh was missed (a sleeping laptop); the URL has now expired.
    timers = [];
    clock += 61_000;
    media.fail(MEDIA_ERR.NETWORK);
    await flush();
    expect(media.sources.at(-1)).toMatchObject({ url: 'https://r2.example/two', startAt: 50 });
    expect(controller.getState().error).toBeNull();
  });

  it('retries a network failure with backoff, and at once when the connection returns', async () => {
    grants.push(grant('https://r2.example/one'));
    const controller = player();
    await controller.load(TRACK);
    media.currentTime = 20;
    media.fail(MEDIA_ERR.NETWORK);
    expect(controller.getState()).toMatchObject({
      status: 'error',
      error: { kind: 'network' },
      wantsToPlay: true,
    });

    // The first retry's fetch fails too: the next waits twice as long.
    grants.push({ ok: false, kind: 'network' });
    advance(NETWORK_RETRY_INITIAL_MS);
    await flush();
    expect(requested).toHaveLength(2);
    expect(controller.getState().error?.kind).toBe('network');
    advance(NETWORK_RETRY_INITIAL_MS);
    await flush();
    expect(requested).toHaveLength(2);

    // Back online: straight away, not at the end of the backoff.
    grants.push(grant('https://r2.example/two'));
    online?.();
    await flush();
    expect(requested).toHaveLength(3);
    expect(media.sources.at(-1)).toMatchObject({ url: 'https://r2.example/two', startAt: 20 });
    expect(controller.getState()).toMatchObject({ status: 'playing', error: null });
  });

  it('stops on a decode failure rather than retrying the same bytes', async () => {
    grants.push(grant('https://r2.example/one'));
    const controller = player();
    await controller.load(TRACK);
    media.fail(MEDIA_ERR.DECODE);
    expect(controller.getState()).toMatchObject({ status: 'error', error: { kind: 'decode' } });
    advance(10 * 60_000);
    await flush();
    expect(requested).toHaveLength(1);
  });

  it('says a version is still processing, and does not retry it by itself', async () => {
    grants.push({ ok: false, kind: 'not_ready' });
    const controller = player();
    await controller.load(TRACK);
    expect(controller.getState()).toMatchObject({ status: 'error', error: { kind: 'not_ready' } });
    expect(media.sources).toEqual([]);
    expect(timers).toEqual([]);
  });

  it('ignores a slow grant for a track that has since been replaced', async () => {
    let release: (value: StreamUrlResult) => void = () => undefined;
    const controller = createPlayer({
      fetchStreamUrl: (versionId) =>
        versionId === 'V1'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(grant('https://r2.example/second')),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    controller.attach(media);
    const first = controller.load(TRACK);
    await controller.load({ ...TRACK, versionId: 'V2' });
    release(grant('https://r2.example/first'));
    await first;
    expect(media.sources.map((source) => source.url)).toEqual(['https://r2.example/second']);
    expect(controller.getState().track?.versionId).toBe('V2');
  });

  it('treats a refused autoplay as ready to play, not as loading', async () => {
    grants.push(grant('https://r2.example/one'));
    media.playRejects = true;
    const controller = player();
    await controller.load(TRACK);
    expect(controller.getState()).toMatchObject({ status: 'ready', wantsToPlay: false });
  });

  it('keeps the URL in memory only', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    grants.push(grant('https://r2.example/secret-url'));
    const controller = player();
    await controller.load(TRACK);
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.getState())).not.toContain('secret-url');
    setItem.mockRestore();
  });

  it('remembers volume and mute across sessions, and applies them to the element', () => {
    const stored: { volume: number; muted: boolean }[] = [];
    const storage = {
      read: () => ({ volume: 0.4, muted: true }),
      write: (value: { volume: number; muted: boolean }) => stored.push(value),
    };
    const controller = createPlayer({ volumeStorage: storage });
    controller.attach(media);
    expect(controller.getState()).toMatchObject({ volume: 0.4, muted: true });
    expect(media).toMatchObject({ volume: 0.4, muted: true });

    controller.setVolume(0.7);
    expect(controller.getState()).toMatchObject({ volume: 0.7, muted: false });
    controller.toggleMute();
    expect(stored.at(-1)).toEqual({ volume: 0.7, muted: true });
    expect(media).toMatchObject({ volume: 0.7, muted: true });
  });

  it('survives storage that throws, as in a private window', () => {
    const controller = createPlayer({
      volumeStorage: {
        read: () => {
          throw new Error('SecurityError');
        },
        write: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    controller.setVolume(0.2);
    expect(controller.getState().volume).toBe(0.2);
  });

  it('restarts the track on previous, and has nothing next without a queue', async () => {
    grants.push(grant('https://r2.example/one'));
    const controller = player();
    await controller.load(TRACK);
    media.currentTime = 90;
    controller.previous();
    expect(media.currentTime).toBe(0);
    expect(controller.hasNext()).toBe(false);
  });

  describe('with a queue (task 073)', () => {
    const second: Track = { ...TRACK, versionId: 'V2', title: 'Tail Lights' };
    const third: Track = { ...TRACK, versionId: 'V3', title: 'Low Beams' };

    function queuedPlayer(extra: Parameters<typeof createPlayer>[0] = {}) {
      const controller = createPlayer({
        now: () => clock,
        setTimer: (callback, ms) => {
          nextId += 1;
          timers.push({ at: clock + ms, callback, id: nextId });
          return nextId;
        },
        clearTimer: (handle) => {
          timers = timers.filter((timer) => timer.id !== handle);
        },
        fetchStreamUrl: async (versionId) => {
          requested.push(versionId);
          return grant(`https://r2.example/${versionId}`);
        },
        ...extra,
      });
      controller.attach(media);
      return controller;
    }

    it('plays through the queue as each track ends, and stops at the end', async () => {
      const controller = queuedPlayer();
      await controller.playQueue([TRACK, second]);
      expect(controller.getState().track?.versionId).toBe('V1');
      expect(controller.hasNext()).toBe(true);
      media.emit('ended');
      await flush();
      expect(controller.getState()).toMatchObject({
        status: 'playing',
        track: { versionId: 'V2' },
      });
      expect(controller.hasNext()).toBe(false);
      media.emit('ended');
      await flush();
      expect(controller.getState()).toMatchObject({ status: 'ended', track: { versionId: 'V2' } });
    });

    it('repeats one track on its own, and moves on when asked', async () => {
      const controller = queuedPlayer();
      await controller.playQueue([TRACK, second]);
      controller.cycleRepeat();
      controller.cycleRepeat();
      expect(controller.getQueue().repeat).toBe('one');
      media.currentTime = 187;
      media.emit('ended');
      await flush();
      expect(controller.getState().track?.versionId).toBe('V1');
      expect(media.currentTime).toBe(0);
      controller.next();
      await flush();
      expect(controller.getState().track?.versionId).toBe('V2');
    });

    it('fetches — and so authorizes — the next track shortly before the end, and uses it', async () => {
      const warmed: string[] = [];
      media.preload = (url: string) => warmed.push(url);
      const controller = queuedPlayer();
      await controller.playQueue([TRACK, second]);
      expect(requested).toEqual(['V1']);
      media.currentTime = 170;
      media.emit('timeupdate');
      await flush();
      expect(requested).toEqual(['V1', 'V2']);
      expect(warmed).toEqual(['https://r2.example/V2']);
      media.emit('ended');
      await flush();
      // No second request at the switch: the preloaded, already-authorized URL is used.
      expect(requested).toEqual(['V1', 'V2']);
      expect(media.sources.at(-1)?.url).toBe('https://r2.example/V2');
    });

    it('goes back a track from the start, and restarts from the middle', async () => {
      const controller = queuedPlayer();
      await controller.playQueue([TRACK, second], 1);
      media.currentTime = 60;
      controller.previous();
      expect(controller.getState().track?.versionId).toBe('V2');
      expect(media.currentTime).toBe(0);
      controller.previous();
      await flush();
      expect(controller.getState().track?.versionId).toBe('V1');
    });

    it('removing the playing track moves on; removing the last one stops', async () => {
      const controller = queuedPlayer();
      await controller.playQueue([TRACK, second]);
      controller.removeFromQueue(0);
      await flush();
      expect(controller.getState().track?.versionId).toBe('V2');
      controller.removeFromQueue(0);
      expect(controller.getState()).toMatchObject({ status: 'idle', track: null });
    });

    it('restores last session’s queue only through the server, dropping what it refuses', async () => {
      const writes: unknown[] = [];
      const asked: (readonly string[])[] = [];
      const controller = queuedPlayer({
        queueStorage: {
          read: () => ({
            versionIds: ['V1', 'V2', 'V3'],
            order: [0, 1, 2],
            position: 1,
            repeat: 'all',
            shuffle: false,
          }),
          write: (value) => writes.push(value),
        },
        authorizeVersions: async (versionIds) => {
          asked.push(versionIds);
          return [TRACK, third]; // V2 was revoked.
        },
      });
      await controller.restoreQueue();
      expect(asked).toEqual([['V1', 'V2', 'V3']]);
      const queue = controller.getQueue();
      expect(queue.items.map((item) => item.versionId)).toEqual(['V1', 'V3']);
      expect(queue.order[queue.position]).toBe(1);
      expect(queue.repeat).toBe('all');
      // Nothing plays until asked, and nothing was fetched for playback.
      expect(controller.getState().track).toBeNull();
      expect(requested).toEqual([]);
      controller.play();
      await flush();
      expect(controller.getState().track?.versionId).toBe('V3');
      // What was written back holds ids, not URLs.
      expect(JSON.stringify(writes)).not.toContain('https://');
    });

    it('restores nothing when the server cannot be asked', async () => {
      const controller = queuedPlayer({
        queueStorage: {
          read: () => ({
            versionIds: ['V1'],
            order: [0],
            position: 0,
            repeat: 'off',
            shuffle: false,
          }),
          write: () => undefined,
        },
        authorizeVersions: async () => null,
      });
      await controller.restoreQueue();
      expect(controller.getQueue().items).toEqual([]);
    });
  });
});
