import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { NewProjectButton, NewSongButton } = await import('../create-dialogs');

describe('create dialogs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.push.mockReset();
  });

  it('validates with the shared schema before posting anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectButton folderId={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the project a name.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a project in the open folder and opens it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'P1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectButton folderId="F1" />);
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    await userEvent.type(screen.getByLabelText('Project name'), 'Night Drive');
    await userEvent.type(screen.getByLabelText(/Artist/), 'The Hours');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Night Drive', artist: 'The Hours', folderId: 'F1' }),
      }),
    );
    expect(router.push).toHaveBeenCalledWith('/projects/P1');
  });

  it('shows the server’s refusal and keeps the dialog open', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 }),
        ),
    );
    render(<NewSongButton projectId="P1" />);
    await userEvent.click(screen.getByRole('button', { name: 'New song' }));
    await userEvent.type(screen.getByLabelText('Song title'), 'Headlights');
    await userEvent.click(screen.getByRole('button', { name: 'Create song' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(router.push).not.toHaveBeenCalled();
  });
});
