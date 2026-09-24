import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { InlineField, InlineStatus } = await import('./inline-field');

const FIELD = {
  endpoint: '/api/songs/S1',
  field: 'title',
  label: 'Title',
  rule: 'songTitle',
  placeholder: 'Untitled',
} as const;

describe('InlineField', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it('is plain text for someone who may not edit', () => {
    render(<InlineField {...FIELD} value="Headlights" editable={false} />);
    expect(screen.getByText('Headlights')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the new value at once and saves it', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((done) => (resolve = done))),
    );
    render(<InlineField {...FIELD} value="Headlights" editable />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title: Headlights' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Headlights (Night Mix){Enter}');
    // Optimistic: on screen before the server has answered.
    expect(
      screen.getByRole('button', { name: 'Edit title: Headlights (Night Mix)' }),
    ).toBeInTheDocument();
    resolve(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('rolls back to the exact previous value and says what failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 }),
        ),
    );
    render(<InlineField {...FIELD} value="Headlights" editable />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title: Headlights' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Something Else{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t save the title: Not found. It’s back to “Headlights”.',
    );
    expect(screen.getByRole('button', { name: 'Edit title: Headlights' })).toBeInTheDocument();
  });

  it('refuses with the shared rule before sending, and Escape cancels', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InlineField {...FIELD} value="Headlights" editable />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title: Headlights' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Give the song a name.');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Edit title: Headlights' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('InlineStatus', () => {
  const OPTIONS = [
    { value: 'idea', label: 'Idea' },
    { value: 'mixing', label: 'Mixing' },
  ];

  it('rolls the status back, in words, when the save fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(
      <InlineStatus endpoint="/api/songs/S1" value="idea" options={OPTIONS} editable>
        <span>Idea</span>
      </InlineStatus>,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'mixing');
    expect(await screen.findByRole('alert')).toHaveTextContent(/It’s back to Idea\./);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('idea');
    vi.unstubAllGlobals();
  });

  it('is the badge for someone who may not edit', () => {
    render(
      <InlineStatus endpoint="/api/songs/S1" value="idea" options={OPTIONS} editable={false}>
        <span>Idea badge</span>
      </InlineStatus>,
    );
    expect(screen.getByText('Idea badge')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
