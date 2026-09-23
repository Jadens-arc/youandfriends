import { forbidden } from '@youandfriends/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The library route's own logic: what it does with a missing workspace, a refusal from
 * `readLibraryTree`, an unknown or inaccessible folder segment, and a success that wires the
 * browser up. `readLibraryTree` and the four mutations are tested against a real database
 * elsewhere (`lib/library/__tests__/folders.test.ts`); the folder tree's own keyboard, expand,
 * and drag behaviour is tested in `components/library/__tests__/folder-tree.test.tsx`. Here the
 * question is how the route responds.
 */

const current = vi.hoisted(() => ({ currentWorkspace: vi.fn() }));
const libraryCtx = vi.hoisted(() => ({ libraryContext: vi.fn() }));
const libraryUseCases = vi.hoisted(() => ({ readLibraryTree: vi.fn() }));
const actions = vi.hoisted(() => ({
  createFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
  moveFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/workspace/current', () => current);
vi.mock('@/lib/library/context', () => libraryCtx);
vi.mock('@/lib/library/folders', () => libraryUseCases);
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => navigation);

const { default: LibraryPage } = await import('../[[...path]]/page');

const CONTEXT = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  workspace: { workspaceId: 'w1', name: 'Blue Hour', role: 'owner' },
  correlationId: undefined,
};

const ROOT = { id: 'root1', name: 'Demos', parentId: null, path: '/root1/' };
const CHILD = { id: 'child1', name: 'Rough mixes', parentId: 'root1', path: '/root1/child1/' };

function tree(
  overrides: Partial<{
    folders: unknown[];
    editableFolderIds: Set<string>;
    mayCreateAtRoot: boolean;
  }> = {},
) {
  return {
    folders: [ROOT, CHILD],
    editableFolderIds: new Set(['root1', 'child1']),
    mayCreateAtRoot: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  current.currentWorkspace.mockResolvedValue(CONTEXT);
  libraryCtx.libraryContext.mockReturnValue({ workspaceId: 'w1' });
  libraryUseCases.readLibraryTree.mockResolvedValue(tree());
});

describe('the library page', () => {
  it('is not found without a workspace', async () => {
    current.currentWorkspace.mockResolvedValue(null);
    await expect(LibraryPage({ params: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(libraryUseCases.readLibraryTree).not.toHaveBeenCalled();
  });

  it('is not found when the tree use case refuses', async () => {
    libraryUseCases.readLibraryTree.mockRejectedValue(forbidden());
    await expect(LibraryPage({ params: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('lets anything else surface as the error it is', async () => {
    libraryUseCases.readLibraryTree.mockRejectedValue(new Error('boom'));
    await expect(LibraryPage({ params: Promise.resolve({}) })).rejects.toThrow('boom');
  });

  it('renders the root folders when no path segment is given', async () => {
    render(await LibraryPage({ params: Promise.resolve({}) }));
    const tree = screen.getByRole('tree', { name: 'Folders' });
    expect(within(tree).getByText('Demos')).toBeInTheDocument();
  });

  it('is not found for a folder id that does not resolve for this subject', async () => {
    // Absent from the workspace, in another workspace, or simply not granted — all the same
    // 404, indistinguishably (`docs/THREAT_MODEL.md` T1).
    await expect(
      LibraryPage({ params: Promise.resolve({ path: ['not-a-real-folder'] }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('opens the folder named by the last path segment', async () => {
    render(await LibraryPage({ params: Promise.resolve({ path: ['root1', 'child1'] }) }));
    // The breadcrumb trail names both ancestors of the open folder.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Demos' + 'Rough mixes',
    );
  });
});
