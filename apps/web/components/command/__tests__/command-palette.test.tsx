import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DEBOUNCE_MS } from '@/lib/command/use-search';
import type { SearchResults } from '@/lib/search/service';
import { useRegisterUploadSurface } from '@/lib/upload/current-surface';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/library' }));

const player = vi.hoisted(() => ({
  state: { track: null as null | { title: string }, wantsToPlay: false },
  toggle: vi.fn(),
}));
vi.mock('@/lib/player/store', () => ({
  usePlayerState: () => player.state,
  getPlayer: () => ({ toggle: player.toggle }),
}));

const { CommandPalette } = await import('../command-palette');

const EMPTY: SearchResults = {
  query: '',
  projects: [],
  songs: [],
  lyrics: [],
  files: [],
  recent: [],
};

/** A fetch whose answers the test releases, one per request, in any order. */
function controllableFetch() {
  const requests: { q: string; signal: AbortSignal; answer: (results: SearchResults) => void }[] =
    [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          requests.push({
            q,
            signal,
            answer: (results) => resolve(new Response(JSON.stringify(results))),
          });
        }),
    ),
  );
  return requests;
}

function Surface() {
  useRegisterUploadSurface({ type: 'song', id: 'S1', name: 'Headlights' });
  return null;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Search and commands' }), {
    target: { value },
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    player.state = { track: null, wantsToPlay: false };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    router.push.mockReset();
    player.toggle.mockReset();
  });

  it('opens on recent items, then goes where one points', async () => {
    const requests = controllableFetch();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);
    await settle();
    expect(requests.map((request) => request.q)).toEqual(['']);
    requests[0]?.answer({
      ...EMPTY,
      recent: [{ id: 'S1', title: 'Headlights', detail: 'Night Drive', href: '/songs/S1' }],
    });
    await settle();
    const recent = screen.getByRole('group', { name: 'Recent' });
    fireEvent.click(within(recent).getByText('Headlights'));
    expect(router.push).toHaveBeenCalledWith('/songs/S1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('debounces typing into one request, and drops a stale answer that arrives late', async () => {
    const requests = controllableFetch();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await settle();
    typeQuery('lo');
    await settle(SEARCH_DEBOUNCE_MS);
    typeQuery('lon');
    typeQuery('long');
    await settle(SEARCH_DEBOUNCE_MS);
    expect(requests.map((request) => request.q)).toEqual(['', 'lo', 'long']);
    // The superseded requests were cancelled, not just ignored.
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');

    requests[2]?.answer({
      ...EMPTY,
      query: 'long',
      lyrics: [
        {
          id: 'S1',
          title: 'Headlights',
          detail: 'Night Drive',
          href: '/songs/S1?tab=lyrics',
          snippet: [
            { text: 'the ', match: false },
            { text: 'long', match: true },
            { text: ' road', match: false },
          ],
        },
      ],
    });
    // The "lo" answer lands afterwards; it must not replace the newer one.
    requests[1]?.answer({
      ...EMPTY,
      query: 'lo',
      songs: [{ id: 'X', title: 'Lonely', detail: null, href: '/songs/X' }],
    });
    await settle();
    expect(screen.queryByText('Lonely')).toBeNull();
    const lyrics = screen.getByRole('group', { name: 'Lyrics' });
    expect(within(lyrics).getByText('long').tagName).toBe('MARK');
    expect(screen.getByRole('status')).toHaveTextContent('1 result');
  });

  it('says so when nothing matches, and when search is unreachable', async () => {
    const requests = controllableFetch();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await settle();
    typeQuery('zzz');
    await settle(SEARCH_DEBOUNCE_MS);
    requests.at(-1)?.answer({ ...EMPTY, query: 'zzz' });
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches “zzz”.');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    typeQuery('zzzz');
    await settle(SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Search is not reachable');
  });

  it('offers actions that do what they say', async () => {
    controllableFetch();
    player.state = { track: { title: 'Headlights' }, wantsToPlay: true };
    const onOpenChange = vi.fn();
    render(
      <>
        <Surface />
        <CommandPalette open onOpenChange={onOpenChange} />
      </>,
    );
    await settle();
    const actions = screen.getByRole('group', { name: 'Actions' });
    expect(within(actions).getByText('Upload files to Headlights')).toBeInTheDocument();

    fireEvent.click(within(actions).getByText('Pause Headlights'));
    expect(player.toggle).toHaveBeenCalledOnce();

    fireEvent.click(within(screen.getByRole('group', { name: 'Go to' })).getByText('Settings'));
    expect(router.push).toHaveBeenCalledWith('/settings');
    fireEvent.click(within(actions).getByText('Create project'));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });

  it('offers no upload where the page takes none, and no playback with nothing loaded', async () => {
    controllableFetch();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await settle();
    const actions = screen.getByRole('group', { name: 'Actions' });
    expect(within(actions).queryByText(/Upload files/)).toBeNull();
    expect(within(actions).queryByText(/^(Play|Pause) /)).toBeNull();
  });

  it('filters actions and destinations by what is typed', async () => {
    controllableFetch();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await settle();
    typeQuery('sett');
    expect(screen.queryByRole('group', { name: 'Actions' })).toBeNull();
    expect(
      within(screen.getByRole('group', { name: 'Go to' })).getByText('Settings'),
    ).toBeInTheDocument();
  });
});
