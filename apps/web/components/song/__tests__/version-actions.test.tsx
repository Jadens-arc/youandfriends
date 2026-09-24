import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { VersionActions } = await import('../versions/version-actions');

import { version } from './fixtures';

const EDITOR = { comment: true, edit: true, download: true } as const;
const VIEWER = { comment: false, edit: false, download: false } as const;

describe('VersionActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it('offers nothing — not even disabled controls — to a viewer without download', () => {
    const { container } = render(
      <VersionActions
        songId="S1"
        version={version({ noteEditable: false })}
        capabilities={VIEWER}
      />,
    );
    expect(container.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('offers an editor make-current, the note, and the original', () => {
    render(<VersionActions songId="S1" version={version({ id: 'V1' })} capabilities={EDITOR} />);
    expect(screen.getByRole('button', { name: 'Make current' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      '/api/songs/S1/versions/V1/download',
    );
  });

  it('does not offer to make the current version current', () => {
    render(
      <VersionActions songId="S1" version={version({ isCurrent: true })} capabilities={EDITOR} />,
    );
    expect(screen.queryByRole('button', { name: 'Make current' })).toBeNull();
  });

  it('saves a note with PATCH and refreshes; a failure keeps the draft and says why', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ message: 'Keep the note under 500 characters.' }, { status: 422 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<VersionActions songId="S1" version={version({ id: 'V1' })} capabilities={EDITOR} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await userEvent.type(screen.getByLabelText('Note for version 1'), 'Vocal up');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Keep the note under 500 characters.',
    );
    expect(screen.getByLabelText('Note for version 1')).toHaveValue('Vocal up');
    expect(router.refresh).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/songs/S1/versions/V1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ note: 'Vocal up' }) }),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByLabelText('Note for version 1')).toBeNull();
  });

  it('makes a version current with one POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<VersionActions songId="S1" version={version({ id: 'V1' })} capabilities={EDITOR} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make current' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/S1/versions/current',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ versionId: 'V1' }) }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });
});
