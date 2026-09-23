import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FavoriteToggle, RecordView } from '../personal';

describe('FavoriteToggle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('toggles at once and sends the new state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FavoriteToggle targetType="song" targetId="S1" initial={false} name="Headlights" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Headlights to favorites' }));
    expect(
      screen.getByRole('button', { name: 'Remove Headlights from favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/favorites',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ targetType: 'song', targetId: 'S1', favorite: true }),
      }),
    );
  });

  it('puts the star back and says so when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'Not found.' }, { status: 404 })),
    );
    render(<FavoriteToggle targetType="song" targetId="S1" initial name="Headlights" />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Headlights from favorites' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t remove it from favorites.',
    );
    expect(
      screen.getByRole('button', { name: 'Remove Headlights from favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('RecordView', () => {
  it('records the view once, after render', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const { rerender } = render(<RecordView targetType="song" targetId="S1" />);
    rerender(<RecordView targetType="song" targetId="S1" />);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledWith('/api/recents', expect.any(Blob));
  });
});
