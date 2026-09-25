import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATE, type Track } from '@/lib/player/machine';
import { buildQueue, EMPTY_QUEUE, type QueueState } from '@/lib/player/queue';

const controller = {
  moveInQueue: vi.fn(),
  removeFromQueue: vi.fn(),
  playFromQueue: vi.fn(),
  toggleShuffle: vi.fn(),
  cycleRepeat: vi.fn(),
  clearQueue: vi.fn(),
};
let queue: QueueState = EMPTY_QUEUE;
vi.mock('@/lib/player/store', () => ({
  getPlayer: () => controller,
  usePlayerState: () => ({ ...INITIAL_STATE, wantsToPlay: true }),
  useQueueState: () => queue,
}));

const { QueuePanel } = await import('../queue-panel');

const track = (id: string, title: string): Track => ({
  versionId: id,
  songId: `S${id}`,
  title,
  artist: null,
  versionLabel: 'Version 1',
});

describe('the queue panel (task 073)', () => {
  beforeEach(() => {
    for (const fn of Object.values(controller)) fn.mockReset();
    queue = buildQueue(
      EMPTY_QUEUE,
      [track('1', 'Headlights'), track('2', 'Tail Lights'), track('3', 'Low Beams')],
      1,
    );
  });

  it('lists the queue in order and says which is playing, in words', () => {
    render(<QueuePanel open onOpenChange={() => undefined} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-current', 'true');
    expect(items[1]).toHaveTextContent('Now playing');
    expect(screen.getByText('3 tracks.')).toBeInTheDocument();
  });

  it('reorders by keyboard-reachable buttons, and says where the track went', () => {
    render(<QueuePanel open onOpenChange={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Move down: Headlights, Version 1, 1 of 3' }),
    );
    expect(controller.moveInQueue).toHaveBeenCalledWith(0, 1);
    expect(screen.getByText('Headlights moved to position 2 of 3.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move up: Headlights, Version 1, 1 of 3' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move down: Low Beams, Version 1, 3 of 3' }),
    ).toBeDisabled();
  });

  it('removes, jumps, shuffles and repeats', () => {
    render(<QueuePanel open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Low Beams, Version 1, 3 of 3' }));
    expect(controller.removeFromQueue).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Play Headlights, Version 1, 1 of 3' }));
    expect(controller.playFromQueue).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle: off' }));
    expect(controller.toggleShuffle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Repeat: off' }));
    expect(controller.cycleRepeat).toHaveBeenCalled();
  });

  it('reorders by drag as well', () => {
    render(<QueuePanel open onOpenChange={() => undefined} />);
    const items = screen.getAllByRole('listitem');
    fireEvent.dragStart(items[2] as HTMLElement);
    fireEvent.drop(items[0] as HTMLElement);
    expect(controller.moveInQueue).toHaveBeenCalledWith(2, 0);
  });
});
