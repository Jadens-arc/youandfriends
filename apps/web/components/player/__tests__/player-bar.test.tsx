import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATE, type PlayerState } from '@/lib/player/machine';

const controller = {
  toggle: vi.fn(),
  previous: vi.fn(),
  next: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  toggleMute: vi.fn(),
  hasNext: () => false,
};
let state: PlayerState = INITIAL_STATE;
vi.mock('@/lib/player/store', async () => {
  const { EMPTY_QUEUE } = await import('@/lib/player/queue');
  return {
    getPlayer: () => controller,
    usePlayerState: () => state,
    useQueueState: () => EMPTY_QUEUE,
  };
});

const { PlayerBar, formatClock, spokenPosition } = await import('../player-bar');

const LONG_TITLE =
  'Headlights on the Long Road Home Through the Valley (Extended Night Drive Reprise)';

function playing(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    ...INITIAL_STATE,
    status: 'playing',
    wantsToPlay: true,
    track: {
      versionId: 'V3',
      songId: 'S1',
      title: LONG_TITLE,
      artist: 'Avery',
      versionLabel: 'Version 3',
      cover: null,
    },
    positionSeconds: 83.9,
    durationSeconds: 296,
    ...overrides,
  };
}

describe('the player bar (task 071)', () => {
  beforeEach(() => {
    state = INITIAL_STATE;
    for (const fn of Object.values(controller))
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  });

  it('says nothing is playing, and offers no transport for nothing', () => {
    render(<PlayerBar />);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('shows the track: title, artist, and the version in words', () => {
    state = playing();
    render(<PlayerBar />);
    const title = screen.getByText(LONG_TITLE);
    // Truncated visually, whole in the DOM and on hover.
    expect(title).toHaveAttribute('title', LONG_TITLE);
    expect(title.className).toContain('truncate');
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText(/Avery/)).toBeInTheDocument();
  });

  it('reflects and drives the transport', () => {
    state = playing();
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(controller.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(controller.previous).toHaveBeenCalledTimes(1);
    // Nothing queued: next is honestly unavailable (task `073`).
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows elapsed and remaining time in tabular figures, and speaks the position', () => {
    state = playing();
    render(<PlayerBar />);
    const elapsed = screen.getByText('1:23');
    const remaining = screen.getByText('-3:32');
    for (const element of [elapsed, remaining]) expect(element.className).toContain('tabular');
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute(
      'aria-valuetext',
      '1 minute 23 seconds of 4 minutes 56 seconds',
    );
  });

  it('mutes and sets the volume', () => {
    state = playing({ volume: 0.6 });
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(controller.toggleMute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '60 percent',
    );
  });

  it('uses the on-espresso focus ring on every control', () => {
    state = playing();
    render(<PlayerBar />);
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('slider')]) {
      expect(control.className, control.getAttribute('aria-label') ?? '').toMatch(
        /outline-ring-on-espresso/,
      );
    }
  });

  it('documents its keyboard shortcuts', () => {
    state = playing();
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Play or pause')).toBeInTheDocument();
  });

  it('formats clocks without running ahead', () => {
    expect(formatClock(59.99)).toBe('0:59');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(null)).toBe('–:––');
    expect(spokenPosition(61, null)).toBe('1 minute 1 second');
  });
});
