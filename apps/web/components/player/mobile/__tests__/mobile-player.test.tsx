import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATE, type ComparisonTrack, type PlayerState } from '@/lib/player/machine';
import { EMPTY_QUEUE } from '@/lib/player/queue';

const controller = {
  toggle: vi.fn(),
  previous: vi.fn(),
  next: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  toggleMute: vi.fn(),
  hasNext: () => false,
  toggleLoopTrack: vi.fn(),
  setLoopIn: vi.fn(),
  setLoopOut: vi.fn(),
  clearLoopRegion: vi.fn(),
  setRate: vi.fn(),
  preservesPitch: () => true,
  switchVersion: vi.fn(),
  currentTime: () => 0,
  load: vi.fn(),
};
let state: PlayerState = INITIAL_STATE;
vi.mock('@/lib/player/store', () => ({
  getPlayer: () => controller,
  usePlayerState: () => state,
  useQueueState: () => EMPTY_QUEUE,
}));
vi.mock('@/lib/waveform/decode', () => ({
  loadWaveform: vi.fn(async () => ({ ok: false, reason: 'not_ready' })),
}));

const { MiniPlayer } = await import('@/components/shell/mobile/mini-player');

const version = (n: number): ComparisonTrack => ({
  versionId: `V${n}`,
  songId: 'S1',
  title: 'Headlights',
  artist: 'Avery',
  versionLabel: `Version ${n}`,
  durationSeconds: 180,
  integratedLufs: -12 - n,
  truePeakDb: -1,
});

function playing(): PlayerState {
  return {
    ...INITIAL_STATE,
    status: 'playing',
    wantsToPlay: true,
    track: version(3),
    durationSeconds: 180,
    positionSeconds: 30,
    comparison: [version(3), version(2)],
  };
}

describe('the mobile player (task 077)', () => {
  beforeEach(() => {
    state = INITIAL_STATE;
    for (const fn of Object.values(controller)) {
      if (typeof fn === 'function' && 'mockReset' in fn)
        (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });

  it('plays and pauses from the mini-player', () => {
    state = playing();
    render(<MiniPlayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(controller.toggle).toHaveBeenCalledTimes(1);
  });

  it('expands on a swipe up the artwork and title, but not on a sideways one', () => {
    state = playing();
    render(<MiniPlayer />);
    const strip = screen.getByRole('button', { name: 'Open player: Headlights' });
    fireEvent.pointerDown(strip, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(strip, { clientX: 180, clientY: 90 });
    expect(screen.queryByRole('dialog', { name: 'Player' })).toBeNull();
    fireEvent.pointerDown(strip, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(strip, { clientX: 104, clientY: 40 });
    expect(screen.getByRole('dialog', { name: 'Player' })).toBeInTheDocument();
  });

  it('expands on a tap too, and binds the swipe to that strip alone', () => {
    state = playing();
    const { container } = render(<MiniPlayer />);
    const strip = container.querySelector('[data-expand-strip]') as HTMLElement;
    expect(strip.className).toContain('touch-none');
    // Nothing else in the page takes vertical gestures from the mini-player.
    expect(container.querySelectorAll('.touch-none')).toHaveLength(1);
    fireEvent.click(strip);
    expect(screen.getByRole('dialog', { name: 'Player' })).toBeInTheDocument();
  });

  it('offers every desktop control in the expanded player, at 44 px', () => {
    state = playing();
    render(<MiniPlayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand player' }));
    const player = within(screen.getByRole('dialog', { name: 'Player' }));
    for (const name of [
      'Previous',
      'Pause',
      'Next',
      'Mute',
      'Queue — nothing queued',
      'Keyboard shortcuts',
      'Loop track',
      'Loop from here',
      'Loop to here',
      'Clear loop',
    ]) {
      const control = player.getByRole('button', { name });
      expect(control.className, name).toMatch(/size-11|size-14|min-h-11/);
    }
    expect(player.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
    expect(player.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    expect(player.getByRole('combobox', { name: 'Speed' }).className).toContain('min-h-11');
    const versions = player.getByRole('radiogroup', { name: 'Sounding version' });
    const options = within(versions).getAllByRole('radio');
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[0]).toHaveTextContent('Sounding');
    for (const option of options) expect(option.className).toContain('min-h-11');
    fireEvent.click(options[1] as HTMLElement);
    expect(controller.switchVersion).toHaveBeenCalledWith('V2');
  });

  it('still shows an empty player honestly', () => {
    render(<MiniPlayer />);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});
