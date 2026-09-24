import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LibraryModules as LibraryModulesData } from '@/lib/library/projects';

import { LibraryModules, StorageUsage } from '../modules';

/**
 * The secondary modules (task `041`). What they may show is decided in `readProjectLibrary`
 * and tested against a real database there; here, that each renders what it is given, and
 * says something warm when it is given nothing.
 */

const NOW = new Date('2026-09-23T12:00:00Z');

const EMPTY: LibraryModulesData = {
  recentSongs: [],
  sharedWithMe: { projects: [], songs: [] },
  favorites: [],
  activity: [],
  storage: null,
};

function section(name: string) {
  return screen.getByRole('region', { name });
}

describe('LibraryModules', () => {
  it('gives every empty module a sentence, not a blank', () => {
    render(<LibraryModules modules={EMPTY} now={NOW} />);
    expect(section('Recent songs')).toHaveTextContent(/will gather here/);
    expect(section('Shared with me')).toHaveTextContent(/will be waiting here/);
    expect(section('Favorites')).toHaveTextContent(/Star the songs/);
    expect(section('Collaborator activity')).toHaveTextContent(/Quiet for now/);
    // Storage is not "empty" for a collaborator — it is absent.
    expect(screen.queryByRole('region', { name: 'Storage' })).toBeNull();
  });

  it('renders each module’s items', () => {
    render(
      <LibraryModules
        now={NOW}
        modules={{
          recentSongs: [
            {
              id: 's1',
              title: 'Hook',
              projectId: 'p1',
              projectName: 'Night Drives',
              updatedAt: new Date('2026-09-23T10:00:00Z'),
            },
          ],
          sharedWithMe: {
            projects: [{ id: 'p1', name: 'Night Drives' }],
            songs: [
              {
                id: 's2',
                title: 'Verse Idea',
                projectId: 'p2',
                projectName: 'Sketches',
                updatedAt: NOW,
              },
              {
                id: 's3',
                title: 'Lone Song',
                projectId: null,
                projectName: null,
                updatedAt: NOW,
              },
            ],
          },
          favorites: [
            { targetType: 'folder', targetId: 'f1', name: 'Demos', projectId: null },
            { targetType: 'song', targetId: 's1', name: 'Hook', projectId: 'p1' },
          ],
          activity: [
            {
              id: 'a1',
              actorName: 'Sam Reed',
              action: 'lyrics.updated',
              targetType: 'song',
              targetId: 's1',
              targetName: 'Hook',
              projectId: 'p1',
              occurredAt: new Date('2026-09-22T12:00:00Z'),
            },
          ],
          storage: { usedBytes: 5 * 1024 ** 3, quotaBytes: 100 * 1024 ** 3 },
        }}
      />,
    );

    expect(section('Recent songs')).toHaveTextContent('Hook');
    expect(section('Recent songs')).toHaveTextContent('Night Drives · 2 hours ago');
    expect(section('Shared with me')).toHaveTextContent('Night Drives');
    expect(section('Shared with me')).toHaveTextContent('Song · Sketches');
    // A song whose project is closed to the viewer is just "Song" — no parent is named.
    const lone = within(section('Shared with me')).getByText('Lone Song').closest('li');
    expect(lone?.textContent).toBe('Lone SongSong');
    expect(within(section('Favorites')).getByRole('link', { name: 'Demos' })).toHaveAttribute(
      'href',
      '/library/f1',
    );
    // Every song and project row opens its destination (task `042`).
    const linkIn = (title: string, name: string) =>
      within(section(title)).getByRole('link', { name }).getAttribute('href');
    expect(linkIn('Recent songs', 'Hook')).toBe('/songs/s1');
    expect(linkIn('Shared with me', 'Night Drives')).toBe('/projects/p1');
    expect(linkIn('Shared with me', 'Lone Song')).toBe('/songs/s3');
    expect(linkIn('Favorites', 'Hook')).toBe('/songs/s1');
    expect(linkIn('Collaborator activity', 'Hook')).toBe('/songs/s1');
    expect(section('Collaborator activity')).toHaveTextContent('Sam Reed edited lyrics for Hook');
    expect(section('Collaborator activity')).toHaveTextContent('yesterday');
    const meter = within(section('Storage')).getByRole('meter', { name: 'Workspace storage' });
    expect(meter).toHaveAttribute('aria-valuenow', '5');
    expect(meter).toHaveAttribute('aria-valuetext', '5 GB of 100 GB used');
  });
});

describe('StorageUsage', () => {
  it('renders nothing at all without usage to show', () => {
    const { container } = render(<StorageUsage usage={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
