import { forbidden } from '@youandfriends/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { songWorkspace } from '@/components/song/__tests__/fixtures';

/**
 * The song route's own logic (task `042`): signed out, refused, and success. The use case is
 * tested against a real database in `lib/songs/__tests__/workspace.test.ts`, including the
 * cross-workspace IDOR cases; here the question is only what the route does with its answer.
 */

const current = vi.hoisted(() => ({ currentWorkspace: vi.fn() }));
const libraryCtx = vi.hoisted(() => ({ libraryContext: vi.fn(() => ({})) }));
const useCases = vi.hoisted(() => ({ readSongWorkspace: vi.fn(), readProjectWorkspace: vi.fn() }));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/songs/S1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/workspace/current', () => current);
vi.mock('@/lib/library/context', () => libraryCtx);
vi.mock('@/lib/songs/workspace', () => useCases);
vi.mock('next/navigation', () => navigation);

const { default: SongPage } = await import('../[songId]/page');
const { default: ProjectPage } = await import('../../projects/[projectId]/page');

const CONTEXT = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  workspace: { workspaceId: 'w1', name: 'Blue Hour', role: 'owner' },
  correlationId: undefined,
};

function song(songId: string, query: Record<string, string> = {}) {
  return SongPage({ params: Promise.resolve({ songId }), searchParams: Promise.resolve(query) });
}

describe('song page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.currentWorkspace.mockResolvedValue(CONTEXT);
  });

  it('is a 404 when signed out or without a workspace', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    await expect(song('S1')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(useCases.readSongWorkspace).not.toHaveBeenCalled();
  });

  it('turns a refusal into a 404, never a 403', async () => {
    useCases.readSongWorkspace.mockRejectedValue(forbidden({ detail: 'foreign song' }));
    await expect(song('FOREIGN')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalled();
  });

  it('lets any other failure through to the error boundary', async () => {
    useCases.readSongWorkspace.mockRejectedValue(new Error('database down'));
    await expect(song('S1')).rejects.toThrow('database down');
  });

  it('renders the song workspace, starting on a linked version', async () => {
    useCases.readSongWorkspace.mockResolvedValue(songWorkspace());
    render(await song('S1', { version: 'V1' }));
    expect(useCases.readSongWorkspace).toHaveBeenCalledWith({}, 'S1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Headlights');
    expect(screen.getByRole('radio', { name: /Version 1/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('project page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.currentWorkspace.mockResolvedValue(CONTEXT);
  });

  it('turns a refusal into a 404', async () => {
    useCases.readProjectWorkspace.mockRejectedValue(forbidden({ detail: 'hidden project' }));
    await expect(ProjectPage({ params: Promise.resolve({ projectId: 'P9' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('lists the project’s songs as links', async () => {
    useCases.readProjectWorkspace.mockResolvedValue({
      project: { id: 'P1', name: 'Night Drive', artist: null, status: 'idea' },
      cover: null,
      folder: null,
      songs: songWorkspace().siblings,
    });
    render(await ProjectPage({ params: Promise.resolve({ projectId: 'P1' }) }));
    expect(screen.getByRole('link', { name: /Tail Lights/ })).toHaveAttribute('href', '/songs/S2');
  });
});
