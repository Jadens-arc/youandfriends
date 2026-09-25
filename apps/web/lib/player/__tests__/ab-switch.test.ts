import { beforeEach, describe, expect, it, vi } from 'vitest';

import { alternateOf, nextInCycle, switchPosition } from '../ab-switch';
import type { MediaAdapter, MediaSnapshot } from '../audio-element';
import type { ComparisonTrack, MediaEventName } from '../machine';
import { createPlayer } from '../store';

vi.mock('@/components/library/personal', () => ({ recordPlay: vi.fn() }));

const version = (n: number, durationSeconds: number | null = 200): ComparisonTrack => ({
  versionId: `V${n}`,
  songId: 'S1',
  title: 'Headlights',
  artist: null,
  versionLabel: `Version ${n}`,
  durationSeconds,
  integratedLufs: -14 + n,
  truePeakDb: -1,
});
const V3 = version(3);
const V2 = version(2);
const V1 = version(1, 150);

describe('A/B helpers (task 075)', () => {
  it('lands at the same instant, or at a shorter version’s end, saying so', () => {
    expect(switchPosition(83.4567, 200)).toEqual({ startAt: 83.4567, clamped: false });
    expect(switchPosition(170, 150)).toEqual({ startAt: 149.95, clamped: true });
    expect(switchPosition(12, null)).toEqual({ startAt: 12, clamped: false });
  });

  it('cycles, and flips back to the last other version heard', () => {
    const versions = [V3, V2, V1];
    expect(nextInCycle(versions, 'V3')).toBe(V2);
    expect(nextInCycle(versions, 'V1')).toBe(V3);
    expect(nextInCycle([V3], 'V3')).toBeNull();
    expect(alternateOf(versions, 'V3', 'V1')).toBe(V1);
    expect(alternateOf(versions, 'V3', null)).toBe(V2);
    expect(alternateOf(versions, 'V3', 'V3')).toBe(V2);
  });
});

class Media implements MediaAdapter {
  currentTime = 0;
  paused = true;
  errorCode = null;
  preservesPitch = true;
  readonly sources: { url: string; startAt: number; play: boolean }[] = [];
  readonly warmed: { url: string; startAt: number | undefined }[] = [];
  private listener: ((event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) | null =
    null;
  setSource(url: string, options: { startAt: number; play: boolean }) {
    this.sources.push({ url, startAt: options.startAt, play: options.play });
    this.currentTime = options.startAt;
    this.emit('canplay');
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
  }
  setVolume() {}
  setRate() {}
  preload(url: string, startAt?: number) {
    this.warmed.push({ url, startAt });
  }
  subscribe(listener: (event: MediaEventName | 'error', snapshot: MediaSnapshot) => void) {
    this.listener = listener;
    return () => undefined;
  }
  emit(event: MediaEventName | 'error') {
    this.listener?.(event, { currentTime: this.currentTime, duration: 200 });
  }
}

describe('switching versions in the player', () => {
  let media: Media;
  let requested: string[];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function player() {
    const controller = createPlayer({
      fetchStreamUrl: async (versionId) => {
        requested.push(versionId);
        return {
          ok: true,
          grant: {
            url: `https://r2.example/${versionId}`,
            expiresAt: new Date(Date.now() + 900_000),
          },
        };
      },
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    controller.attach(media);
    return controller;
  }

  beforeEach(() => {
    media = new Media();
    requested = [];
  });

  it('switches at the same instant, to the millisecond, still playing', async () => {
    const controller = player();
    await controller.load(V3);
    controller.setComparison([V3, V2, V1]);
    await flush();
    media.currentTime = 83.4567;
    await controller.switchVersion('V2');
    const last = media.sources.at(-1);
    expect(last?.url).toBe('https://r2.example/V2');
    expect(Math.abs((last?.startAt ?? 0) - 83.4567)).toBeLessThan(0.001);
    expect(last?.play).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: 'playing',
      track: { versionId: 'V2', versionLabel: 'Version 2' },
      switchNotice: null,
    });
  });

  it('keeps a paused track paused across the switch', async () => {
    const controller = player();
    await controller.load(V3);
    controller.pause();
    controller.setComparison([V3, V2]);
    media.currentTime = 40;
    await controller.switchVersion('V2');
    expect(media.sources.at(-1)).toMatchObject({ startAt: 40, play: false });
    expect(controller.getState().wantsToPlay).toBe(false);
  });

  it('authorizes the alternate separately, ahead of time, and warms it where playback is', async () => {
    const controller = player();
    await controller.load(V3);
    media.currentTime = 60;
    controller.setComparison([V3, V2, V1]);
    await flush();
    // Its own request — its own authorization — before any switch.
    expect(requested).toEqual(['V3', 'V2']);
    expect(media.warmed).toEqual([{ url: 'https://r2.example/V2', startAt: 60 }]);
    await controller.switchVersion('V2');
    // No second request for V2 at the switch: the prepared URL is used. (V3 is then prepared as
    // the new alternate, for the flip back.)
    expect(requested.filter((id) => id === 'V2')).toHaveLength(1);
    expect(media.sources.at(-1)?.url).toBe('https://r2.example/V2');
  });

  it('clamps to a shorter version’s end, and says so', async () => {
    const controller = player();
    await controller.load(V3);
    controller.setComparison([V3, V2, V1]);
    media.currentTime = 170;
    await controller.switchVersion('V1');
    expect(media.sources.at(-1)?.startAt).toBeCloseTo(149.95, 3);
    expect(controller.getState().switchNotice).toBe('Version 1 is shorter — playing from its end.');
  });

  it('flips back and forth with A/B, cycles with next, and keeps the loop and the queue', async () => {
    const controller = player();
    await controller.load(V3);
    controller.setComparison([V3, V2, V1]);
    controller.setLoopRegion(10, 20);
    await controller.switchVersion('V1');
    await controller.toggleAB();
    expect(controller.getState().track?.versionId).toBe('V3');
    await controller.toggleAB();
    expect(controller.getState().track?.versionId).toBe('V1');
    await controller.cycleVersion();
    expect(controller.getState().track?.versionId).toBe('V3');
    expect(controller.getState().loopRegion).toEqual({ start: 10, end: 20 });
    expect(controller.getQueue().items.map((item) => item.versionId)).toEqual(['V3']);
  });

  it('ignores a switch to a version of another song, or with no comparison offered', async () => {
    const controller = player();
    await controller.load(V3);
    await controller.switchVersion('V2');
    expect(controller.getState().track?.versionId).toBe('V3');
    controller.setComparison([V3, V2]);
    await controller.switchVersion('V-elsewhere');
    expect(controller.getState().track?.versionId).toBe('V3');
  });
});
