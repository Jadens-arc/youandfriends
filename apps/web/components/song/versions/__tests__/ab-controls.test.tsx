import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { version } from '@/components/song/__tests__/fixtures';
import { INITIAL_STATE, type PlayerState } from '@/lib/player/machine';

const controller = { setComparison: vi.fn(), switchVersion: vi.fn() };
let state: PlayerState = INITIAL_STATE;
vi.mock('@/lib/player/store', () => ({ getPlayer: () => controller, usePlayerState: () => state }));

const { ABControls } = await import('../ab-controls');

const VERSIONS = [
  version({ id: 'V3', number: 3, integratedLufs: -9.1, truePeakDb: -0.2 }),
  version({ id: 'V2', number: 2, integratedLufs: -14.2, truePeakDb: -1.1 }),
  version({ id: 'V1', number: 1, processingState: 'running' }),
];

function renderControls() {
  return render(
    <ABControls
      songId="S1"
      songTitle="Headlights"
      artist={null}
      cover={null}
      versions={VERSIONS}
    />,
  );
}

describe('A/B controls (task 075)', () => {
  beforeEach(() => {
    controller.setComparison.mockReset();
    controller.switchVersion.mockReset();
    state = INITIAL_STATE;
  });

  it('appear only while this song is the one playing', () => {
    renderControls();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(controller.setComparison).not.toHaveBeenCalled();
  });

  it('offer every ready version with its loudness, and say which is sounding', () => {
    state = {
      ...INITIAL_STATE,
      status: 'playing',
      track: {
        versionId: 'V3',
        songId: 'S1',
        title: 'Headlights',
        artist: null,
        versionLabel: 'Version 3',
      },
    };
    renderControls();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2); // Version 1 is still processing.
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[0]).toHaveTextContent('Sounding');
    expect(options[0]).toHaveTextContent('−9.1 LUFS');
    expect(options[1]).toHaveTextContent('−14.2 LUFS');
    expect(controller.setComparison).toHaveBeenCalledWith([
      expect.objectContaining({ versionId: 'V3', integratedLufs: -9.1 }),
      expect.objectContaining({ versionId: 'V2' }),
    ]);
    fireEvent.click(options[1] as HTMLElement);
    expect(controller.switchVersion).toHaveBeenCalledWith('V2');
  });

  it('shows the note when a switch had to clamp', () => {
    state = {
      ...INITIAL_STATE,
      status: 'playing',
      track: {
        versionId: 'V2',
        songId: 'S1',
        title: 'Headlights',
        artist: null,
        versionLabel: 'Version 2',
      },
      switchNotice: 'Version 2 is shorter — playing from its end.',
    };
    renderControls();
    expect(screen.getByRole('status')).toHaveTextContent('Version 2 is shorter');
  });
});
