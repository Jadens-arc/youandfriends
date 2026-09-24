import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSongTab } from '@/lib/songs/tabs';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const location = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/songs/S1',
  useSearchParams: () => new URLSearchParams(location.search),
}));

const { SongTabs } = await import('../song-tabs');

const PANELS = {
  overview: <p>overview panel</p>,
  lyrics: <p>lyrics panel</p>,
  files: <p>files panel</p>,
  activity: <p>activity panel</p>,
};

describe('SongTabs', () => {
  beforeEach(() => {
    router.replace.mockReset();
    location.search = '';
  });

  it('offers the four sections, in order', () => {
    render(<SongTabs panels={PANELS} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Lyrics',
      'Files',
      'Comments & activity',
    ]);
  });

  it('opens on the tab the URL names — which is what makes a reload land there', () => {
    location.search = 'tab=lyrics&version=V2';
    render(<SongTabs panels={PANELS} />);
    expect(screen.getByRole('tab', { name: 'Lyrics' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('lyrics panel')).toBeVisible();
  });

  it('writes the chosen tab into the URL with replace, keeping other parameters', async () => {
    location.search = 'version=V2';
    render(<SongTabs panels={PANELS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(router.replace).toHaveBeenCalledWith('/songs/S1?version=V2&tab=files', {
      scroll: false,
    });
    // Optimistic: selected before the router commits.
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  it('drops the parameter for Overview, so the plain song URL is the canonical one', async () => {
    location.search = 'tab=files';
    render(<SongTabs panels={PANELS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(router.replace).toHaveBeenCalledWith('/songs/S1', { scroll: false });
  });

  it('is operable from the keyboard', async () => {
    render(<SongTabs panels={PANELS} />);
    await userEvent.tab();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Lyrics' })).toHaveFocus();
  });
});

describe('parseSongTab', () => {
  it('falls back to Overview for anything it does not recognize', () => {
    expect(parseSongTab('lyrics')).toBe('lyrics');
    expect(parseSongTab(['files', 'lyrics'])).toBe('files');
    expect(parseSongTab('LYRICS')).toBe('overview');
    expect(parseSongTab('<script>')).toBe('overview');
    expect(parseSongTab(undefined)).toBe('overview');
    expect(parseSongTab(null)).toBe('overview');
  });
});
