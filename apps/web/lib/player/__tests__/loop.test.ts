import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaAdapter, MediaSnapshot } from '../audio-element';
import { normalizeRegion, pastLoopEnd, withIn, withOut } from '../loop';
import type { MediaEventName, Track } from '../machine';
import { createPlayer, type LoopStorage } from '../store';

vi.mock('@/components/library/personal', () => ({ recordPlay: vi.fn() }));

const TRACK: Track = {
  versionId: 'V1',
  songId: 'S1',
  title: 'T',
  artist: null,
  versionLabel: 'Version 1',
};

describe('loop regions, as arithmetic (task 074)', () => {
  it('keeps a region inside the track and refuses one too short to be a loop', () => {
    expect(normalizeRegion(12, 8, 180)).toEqual({ start: 8, end: 12 });
    expect(normalizeRegion(-3, 400, 180)).toEqual({ start: 0, end: 180 });
    expect(normalizeRegion(10, 10.1, 180)).toBeNull();
  });

  it('sets in and out from the playhead, keeping the other end when it still makes sense', () => {
    expect(withIn(null, 30, 180)).toEqual({ start: 30, end: 180 });
    expect(withIn({ start: 10, end: 60 }, 30, 180)).toEqual({ start: 30, end: 60 });
    expect(withIn({ start: 10, end: 20 }, 30, 180)).toEqual({ start: 30, end: 180 });
    expect(withOut(null, 40, 180)).toEqual({ start: 0, end: 40 });
    expect(withOut({ start: 10, end: 60 }, 40, 180)).toEqual({ start: 10, end: 40 });
  });

  it('knows when playback has run past the end, or been sought out of the region backwards', () => {
    const region = { start: 10, end: 12 };
    expect(pastLoopEnd(11.9, region)).toBe(false);
    expect(pastLoopEnd(11.995, region)).toBe(true);
    expect(pastLoopEnd(5, region)).toBe(true);
  });
});

class Media implements MediaAdapter {
  currentTime = 0;
  paused = true;
  errorCode = null;
  rate = 1;
  preservesPitch = true;
  plays = 0;
  private listener: ((event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) | null =
    null;
  setSource(_url: string, options: { startAt: number; play: boolean }) {
    this.currentTime = options.startAt;
    this.emit('canplay');
    if (options.play) {
      this.paused = false;
      this.emit('durationchange');
      this.emit('playing');
    }
  }
  clearSource() {}
  async play() {
    this.plays += 1;
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
  setVolume() {}
  setRate(rate: number) {
    this.rate = rate;
  }
  subscribe(listener: (event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) {
    this.listener = listener;
    return () => undefined;
  }
  emit(event: MediaEventName | 'error') {
    this.listener?.(event, { currentTime: this.currentTime, duration: 180 });
  }
}

describe('the controller’s loops and speed', () => {
  let media: Media;
  let frames: (() => void)[];
  let stored: Map<string, { start: number; end: number } | null>;
  let writes: [string, { start: number; end: number } | null][];

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function player() {
    const loopStorage: LoopStorage = {
      read: async (songId) => stored.get(songId) ?? null,
      write: async (songId, region) => {
        writes.push([songId, region]);
      },
    };
    const controller = createPlayer({
      fetchStreamUrl: async () => ({
        ok: true,
        grant: { url: 'https://r2.example/x', expiresAt: new Date(Date.now() + 900_000) },
      }),
      setTimer: () => 0,
      clearTimer: () => undefined,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => undefined,
      loopStorage,
    });
    controller.attach(media);
    return controller;
  }

  function runFrame() {
    const frame = frames.shift();
    frame?.();
  }

  beforeEach(() => {
    media = new Media();
    frames = [];
    stored = new Map();
    writes = [];
  });

  it('jumps back to the loop start on the frame playback reaches its end', async () => {
    const controller = player();
    await controller.load(TRACK);
    media.currentTime = 10;
    controller.setLoopIn();
    media.currentTime = 12;
    controller.setLoopOut();
    expect(controller.getState().loopRegion).toEqual({ start: 10, end: 12 });

    media.currentTime = 11.5;
    runFrame();
    expect(media.currentTime).toBe(11.5);
    media.currentTime = 12.005;
    runFrame();
    expect(media.currentTime).toBe(10);
    // Still watching, frame after frame, while it plays.
    expect(frames.length).toBeGreaterThan(0);
  });

  it('stops watching when paused or cleared', async () => {
    const controller = player();
    await controller.load(TRACK);
    controller.setLoopRegion(10, 12);
    controller.pause();
    frames.forEach((frame) => frame());
    frames = [];
    media.currentTime = 20;
    runFrame();
    expect(media.currentTime).toBe(20);
    controller.clearLoopRegion();
    expect(controller.getState().loopRegion).toBeNull();
  });

  it('remembers the region for this song, and brings it back when the song is loaded again', async () => {
    const controller = player();
    await controller.load(TRACK);
    controller.setLoopRegion(30, 45);
    expect(writes).toEqual([['S1', { start: 30, end: 45 }]]);
    controller.clearLoopRegion();
    expect(writes.at(-1)).toEqual(['S1', null]);

    stored.set('S1', { start: 5, end: 9 });
    await controller.load(TRACK);
    await flush();
    expect(controller.getState().loopRegion).toEqual({ start: 5, end: 9 });
    // Another song starts with no region.
    await controller.load({ ...TRACK, songId: 'S2', versionId: 'V9' });
    await flush();
    expect(controller.getState().loopRegion).toBeNull();
  });

  it('loops the whole track at its end', async () => {
    const controller = player();
    await controller.load(TRACK);
    controller.toggleLoopTrack();
    media.currentTime = 180;
    const plays = media.plays;
    media.emit('ended');
    expect(media.currentTime).toBe(0);
    expect(media.plays).toBe(plays + 1);
  });

  it('changes speed, keeps it across tracks, and says whether pitch is preserved', async () => {
    const controller = player();
    await controller.load(TRACK);
    controller.setRate(0.5);
    expect(media.rate).toBe(0.5);
    await controller.load({ ...TRACK, versionId: 'V2' });
    expect(controller.getState().rate).toBe(0.5);
    controller.setRate(9);
    expect(controller.getState().rate).toBe(2);
    expect(controller.preservesPitch()).toBe(true);
    media.preservesPitch = false;
    expect(controller.preservesPitch()).toBe(false);
  });
});
