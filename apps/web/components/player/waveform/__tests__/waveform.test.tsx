import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATE, type PlayerState, type Track } from '@/lib/player/machine';
import type { DecodedTier } from '@/lib/waveform/decode';

const controller = { seek: vi.fn(), load: vi.fn(), currentTime: () => 0 };
let state: PlayerState = INITIAL_STATE;
vi.mock('@/lib/player/store', () => ({ getPlayer: () => controller, usePlayerState: () => state }));

let result: { ok: true; tier: DecodedTier } | { ok: false; reason: 'not_ready' } = {
  ok: false,
  reason: 'not_ready',
};
vi.mock('@/lib/waveform/decode', () => ({ loadWaveform: vi.fn(async () => result) }));

const { drawWaveform, positionForKey, timeAtX, Waveform } = await import('../waveform');

const TIER: DecodedTier = {
  channels: 2,
  sampleRateHz: 100,
  frameCount: 100 * 200, // 200 seconds
  framesPerBucket: 100,
  peaks: Int8Array.from({ length: 400 }, (_, index) => (index % 2 === 0 ? -64 : 64)),
};

const TRACK: Track = {
  versionId: 'V2',
  songId: 'S1',
  title: 'Headlights',
  artist: null,
  versionLabel: 'Version 2',
};

function recorder() {
  const rects: { style: unknown; x: number; y: number; w: number; h: number }[] = [];
  const context = {
    fillStyle: '' as unknown,
    clearRect: vi.fn(),
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ style: context.fillStyle, x, y, w, h });
    },
  };
  return { context, rects };
}

describe('drawing the waveform (task 072)', () => {
  const colors = { played: 'played', unplayed: 'unplayed', playhead: 'playhead' };

  it('draws one bar per column, played up to the playhead, and the playhead itself', () => {
    const { context, rects } = recorder();
    drawWaveform(context, TIER, { width: 100, height: 40, progress: 0.25, colors });
    const bars = rects.slice(0, -1);
    expect(bars).toHaveLength(100);
    expect(bars.filter((rect) => rect.style === 'played')).toHaveLength(25);
    expect(bars[25]?.style).toBe('unplayed');
    expect(rects.at(-1)).toMatchObject({ style: 'playhead', x: 25, h: 40 });
    // Half-scale peaks span the middle half of the height.
    expect(bars[0]).toMatchObject({ y: 40 / 2 - (64 / 127) * 20 });
  });

  it('draws a hairline for silence rather than nothing', () => {
    const { context, rects } = recorder();
    drawWaveform(
      context,
      { ...TIER, peaks: new Int8Array(400) },
      { width: 10, height: 40, progress: 0, colors },
    );
    expect(rects.slice(0, -1).every((rect) => rect.h === 1)).toBe(true);
  });

  it('maps a point to a time, and keys to fine and coarse steps', () => {
    expect(timeAtX(50, 200, 180)).toBe(45);
    expect(timeAtX(-10, 200, 180)).toBe(0);
    expect(timeAtX(500, 200, 180)).toBe(180);
    expect(positionForKey('ArrowRight', 60, 200)).toBe(65);
    expect(positionForKey('ArrowLeft', 2, 200)).toBe(0);
    expect(positionForKey('PageUp', 60, 200)).toBe(90);
    expect(positionForKey('PageDown', 60, 200)).toBe(30);
    expect(positionForKey('Home', 60, 200)).toBe(0);
    expect(positionForKey('End', 60, 200)).toBe(200);
    expect(positionForKey('a', 60, 200)).toBeNull();
  });
});

describe('the waveform component', () => {
  beforeEach(() => {
    state = INITIAL_STATE;
    controller.seek.mockReset();
    controller.load.mockReset();
    // jsdom has no canvas; the component draws into the same recording context the drawing
    // tests use, so the draw path runs rather than being skipped.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recorder().context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 128,
      left: 0,
      top: 0,
      right: 400,
      bottom: 128,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  it('says so when the version has no waveform yet', async () => {
    result = { ok: false, reason: 'not_ready' };
    render(<Waveform track={TRACK} label="Seek in Headlights, Version 2" />);
    expect(
      await screen.findByText('The waveform will appear once this version has been processed.'),
    ).toBeInTheDocument();
  });

  it('is a slider with a name and a spoken position', async () => {
    result = { ok: true, tier: TIER };
    state = { ...INITIAL_STATE, track: TRACK, status: 'paused', positionSeconds: 83 };
    render(<Waveform track={TRACK} label="Seek in Headlights, Version 2" />);
    const slider = await screen.findByRole('slider', { name: 'Seek in Headlights, Version 2' });
    await waitFor(() =>
      expect(slider).toHaveAttribute(
        'aria-valuetext',
        '1 minute 23 seconds of 3 minutes 20 seconds',
      ),
    );
    expect(slider).toHaveAttribute('aria-valuemax', '200');
    expect(slider).toHaveAttribute('tabindex', '0');
  });

  it('seeks the loaded version by keyboard, fine and coarse', async () => {
    result = { ok: true, tier: TIER };
    state = { ...INITIAL_STATE, track: TRACK, status: 'paused', positionSeconds: 60 };
    render(<Waveform track={TRACK} label="Seek" />);
    const slider = await screen.findByRole('slider', { name: 'Seek' });
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuemax', '200'));
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'PageDown' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(controller.seek.mock.calls.map(([seconds]) => seconds)).toEqual([65, 30, 200]);
  });

  it('seeks where it is clicked, showing the time under the pointer first', async () => {
    result = { ok: true, tier: TIER };
    state = { ...INITIAL_STATE, track: TRACK, status: 'playing', wantsToPlay: true };
    render(<Waveform track={TRACK} label="Seek" />);
    const slider = await screen.findByRole('slider', { name: 'Seek' });
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuemax', '200'));
    fireEvent.pointerMove(slider, { clientX: 100 });
    expect(screen.getByText('0:50')).toBeInTheDocument();
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 200, pointerId: 1 });
    expect(controller.seek).toHaveBeenCalledWith(100);
  });

  it('starts a version that is not playing from where it was clicked', async () => {
    result = { ok: true, tier: TIER };
    render(<Waveform track={TRACK} label="Seek" />);
    const slider = await screen.findByRole('slider', { name: 'Seek' });
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuemax', '200'));
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(controller.load).toHaveBeenCalledWith(TRACK, { autoplay: true, startAt: 30 });
  });
});
