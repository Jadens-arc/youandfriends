import { forbidden } from '@youandfriends/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectLibrary } from '@/lib/library/projects';

/**
 * The shelf's own decisions (task `041`): first run versus an empty folder versus projects,
 * sorting applied, and modules at the root only. What `readProjectLibrary` returns is tested
 * against a real database in `lib/library/__tests__/projects.test.ts`.
 */

const useCases = vi.hoisted(() => ({ readProjectLibrary: vi.fn() }));
vi.mock('@/lib/library/projects', () => useCases);

vi.mock('next/navigation', async () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { ProjectShelf } = await import('../[[...path]]/project-shelf');

const NOW = new Date('2026-09-23T12:00:00Z');
const CONTEXT = { now: () => NOW } as never;

function library(overrides: Partial<ProjectLibrary> = {}): ProjectLibrary {
  const card = (id: string, name: string, active: string) => ({
    id,
    name,
    artist: null,
    songCount: 1,
    createdAt: new Date('2026-01-01'),
    lastActivityAt: new Date(active),
    cover: null,
    collaborators: [],
  });
  return {
    projects: [card('p1', 'Bravo', '2026-09-01'), card('p2', 'Alpha', '2026-09-10')],
    hasAnyProject: true,
    modules: {
      recentSongs: [],
      sharedWithMe: { projects: [], songs: [] },
      favorites: [],
      activity: [],
      storage: null,
    },
    ...overrides,
  };
}

async function shelf(props: {
  folder?: { id: string; name: string } | null;
  view?: 'grid' | 'list';
  sort?: 'recent' | 'name' | 'artist' | 'created';
}) {
  render(
    await ProjectShelf({
      context: CONTEXT,
      folder: props.folder ?? null,
      view: props.view ?? 'grid',
      sort: props.sort ?? 'recent',
      quotaBytes: 1024,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCases.readProjectLibrary.mockResolvedValue(library());
});

describe('ProjectShelf', () => {
  it('is not found when the library refuses, like the page it streams into', async () => {
    useCases.readProjectLibrary.mockRejectedValue(forbidden());
    await expect(shelf({})).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('lets anything else surface as the error it is', async () => {
    useCases.readProjectLibrary.mockRejectedValue(new Error('boom'));
    await expect(shelf({})).rejects.toThrow('boom');
  });

  it('asks for the open folder and passes the quota through', async () => {
    await shelf({ folder: { id: 'f1', name: 'Demos' } });
    expect(useCases.readProjectLibrary).toHaveBeenCalledWith(CONTEXT, {
      folderId: 'f1',
      quotaBytes: 1024,
    });
  });

  it('orders the shelf by the chosen sort', async () => {
    await shelf({ sort: 'recent' });
    const list = screen.getByRole('list', { name: 'Projects' });
    expect(
      within(list)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Alpha', 'Bravo']);
  });

  it('shows the modules at the root', async () => {
    await shelf({});
    expect(screen.getByRole('complementary', { name: 'Around the library' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('shows only the folder’s projects inside a folder, under its name', async () => {
    await shelf({ folder: { id: 'f1', name: 'Demos' } });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Demos' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Projects in Demos' })).toBeInTheDocument();
  });

  it('shows the first-run invitation when there is nothing anywhere', async () => {
    useCases.readProjectLibrary.mockResolvedValue(library({ projects: [], hasAnyProject: false }));
    await shelf({});
    expect(screen.getByRole('heading', { name: 'Your shelf is ready' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Projects' })).toBeNull();
    // A song-only collaborator still needs their modules — "Shared with me" is their library.
    expect(screen.getByRole('region', { name: 'Shared with me' })).toBeInTheDocument();
  });

  it('shows an empty folder as empty, not as a first run', async () => {
    useCases.readProjectLibrary.mockResolvedValue(library({ projects: [], hasAnyProject: true }));
    await shelf({ folder: { id: 'f1', name: 'Demos' } });
    expect(screen.getByText('Nothing filed in Demos yet')).toBeInTheDocument();
    expect(screen.queryByText('Your shelf is ready')).toBeNull();
  });
});
