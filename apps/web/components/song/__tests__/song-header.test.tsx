import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { SongHeader } = await import('../song-header');
const { SongList } = await import('../song-list');
const { SplitLayout } = await import('../song-workspace');

import { songWorkspace } from './fixtures';

describe('SongHeader', () => {
  it('shows every required fact and action', () => {
    render(<SongHeader workspace={songWorkspace()} />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Headlights on the Long Road Home Through the Valley');
    // Reflows instead of truncating the one thing the page is about.
    expect(title.className).not.toMatch(/truncate/);
    expect(screen.getByRole('link', { name: 'Night Drive' })).toHaveAttribute(
      'href',
      '/projects/P1',
    );
    expect(screen.getByText('The Hours')).toBeInTheDocument();
    expect(screen.getByText('3:07')).toBeInTheDocument();
    expect(screen.getByText('3 minutes 7 seconds')).toBeInTheDocument();
    expect(screen.getByText('Mixing')).toBeInTheDocument();
    expect(screen.getByText('Shared with Avery Stone and Sam Reed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('never names a project the viewer cannot open', () => {
    render(<SongHeader workspace={songWorkspace({ project: null })} />);
    expect(screen.queryByText('Night Drive')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('pairs the status with a word, never colour alone', () => {
    const viewer = { comment: false, edit: false, download: false };
    render(<SongHeader workspace={songWorkspace({ capabilities: viewer })} />);
    expect(screen.getByText('Status:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Mixing')).toBeInTheDocument();
  });

  it('shows viewers plain text, never a disabled field', () => {
    const viewer = { comment: false, edit: false, download: false };
    render(<SongHeader workspace={songWorkspace({ capabilities: viewer })} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('lets an editor edit the title, artist, and status in place', () => {
    render(<SongHeader workspace={songWorkspace()} />);
    expect(screen.getByRole('button', { name: /^Edit title:/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit artist: The Hours' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('mixing');
  });
});

describe('SongList', () => {
  it('links each song and marks the open one with aria-current', () => {
    const { siblings } = songWorkspace();
    render(<SongList songs={siblings} currentSongId="S1" label="Songs in Night Drive" />);
    expect(screen.getByRole('navigation', { name: 'Songs in Night Drive' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Headlights/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Tail Lights/ })).toHaveAttribute('href', '/songs/S2');
    expect(screen.getByRole('link', { name: /Tail Lights/ })).not.toHaveAttribute('aria-current');
  });
});

describe('SplitLayout', () => {
  it('shows the list beside the song on desktop, and only the song on a phone', () => {
    render(
      <SplitLayout
        list={<p>list</p>}
        detail={<p>detail</p>}
        listLabel="Songs"
        showListOnMobile={false}
      />,
    );
    const layout = screen.getByTestId('split-layout');
    expect(layout.className).toMatch(/md:grid-cols-/);
    const aside = screen.getByRole('complementary', { name: 'Songs' });
    expect(aside.className).toMatch(/(^| )hidden( |$)/);
    expect(aside.className).toMatch(/md:block/);
  });

  it('shows the list on a phone for the project view', () => {
    render(
      <SplitLayout list={<p>list</p>} detail={<p>detail</p>} listLabel="Songs" showListOnMobile />,
    );
    const aside = screen.getByRole('complementary', { name: 'Songs' });
    expect(aside.className).not.toMatch(/(^| )hidden( |$)/);
  });
});
