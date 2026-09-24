import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SongFile } from '@/lib/songs/workspace';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { applyFilter, buildTree, ProjectFiles } = await import('../files/project-files');
const { FileActionDialog } = await import('../files/file-actions');

const NOW = new Date('2026-09-23T12:00:00Z');

function file(overrides: Partial<SongFile>): SongFile {
  return {
    id: 'A1',
    kind: 'project_file',
    name: 'Notes.txt',
    folderPath: '',
    tags: [],
    versionCount: 1,
    sizeBytes: 1024,
    contentType: null,
    uploadedAt: new Date('2026-09-20T12:00:00Z'),
    uploaderName: 'Avery Stone',
    processingState: null,
    ...overrides,
  };
}

const FILES = [
  file({
    id: 'L',
    name: 'Night Drive.logicx.zip',
    folderPath: '/Logic/',
    tags: ['Logic'],
    sizeBytes: 900,
    versionCount: 3,
  }),
  file({
    id: 'M',
    name: 'Beat 2.xpj',
    folderPath: '/MPC/Beats/',
    tags: ['mpc'],
    sizeBytes: 50,
    uploadedAt: new Date('2026-09-22T12:00:00Z'),
  }),
  file({ id: 'D', name: 'Drums.mid', tags: ['logic'], sizeBytes: 2048 }),
  file({ id: 'N', name: 'Beat 10.xpj', folderPath: '/MPC/Beats/' }),
];

describe('applyFilter and buildTree', () => {
  it('filters by tag case-insensitively and by type, and sorts naturally', () => {
    const tagged = applyFilter(FILES, { tag: 'LOGIC', type: 'all', sort: 'name' });
    expect(tagged.map((f) => f.id)).toEqual(['D', 'L']);
    expect(applyFilter(FILES, { tag: null, type: 'midi', sort: 'name' }).map((f) => f.id)).toEqual([
      'D',
    ]);
    expect(
      applyFilter(FILES, { tag: null, type: 'archive', sort: 'name' }).map((f) => f.name),
    ).toEqual(['Beat 2.xpj', 'Beat 10.xpj', 'Night Drive.logicx.zip']);
    expect(applyFilter(FILES, { tag: null, type: 'all', sort: 'size' })[0]?.id).toBe('D');
    expect(applyFilter(FILES, { tag: null, type: 'all', sort: 'newest' })[0]?.id).toBe('M');
  });

  it('nests files under the person’s own folders', () => {
    const tree = buildTree(FILES);
    expect([...tree.children.keys()].sort()).toEqual(['Logic', 'MPC']);
    expect(
      tree.children
        .get('MPC')
        ?.children.get('Beats')
        ?.files.map((f) => f.id),
    ).toEqual(['M', 'N']);
    expect(tree.files.map((f) => f.id)).toEqual(['D']);
  });
});

describe('ProjectFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it('lists type, size, time, uploader, and version count, with folders and tags', () => {
    render(<ProjectFiles files={FILES} canEdit={false} knownTags={[]} now={NOW} />);
    const logic = screen.getByText('Night Drive.logicx.zip').closest('li') as HTMLElement;
    expect(logic).toHaveTextContent('Project & archive');
    expect(logic).toHaveTextContent('900 B');
    expect(logic).toHaveTextContent('3 days ago');
    expect(logic).toHaveTextContent('Avery Stone');
    expect(logic).toHaveTextContent('3 versions');
    expect(screen.getByText('Beats').closest('summary')).not.toBeNull();
    // Read-only: no actions for someone who may not edit.
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('filters from the toolbar and from a tag chip', async () => {
    render(<ProjectFiles files={FILES} canEdit={false} knownTags={[]} now={NOW} />);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'midi');
    expect(screen.getByText('1 of 4 files')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'all');
    await userEvent.click(screen.getByRole('button', { name: 'Show files tagged mpc' }));
    expect(screen.getByText('1 of 4 files')).toBeInTheDocument();
    expect(screen.getByLabelText('Tag')).toHaveValue('mpc');
  });

  it('moves a file into a new folder through PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <FileActionDialog
        file={FILES[2] as SongFile}
        mode="move"
        folders={['/Logic/']}
        knownTags={[]}
        onClose={onClose}
      />,
    );
    await userEvent.type(screen.getByLabelText('Folder'), 'Sessions/2026');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets/D',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ folder: 'Sessions/2026' }),
      }),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('normalizes tags before sending, and trashes with DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(
      <FileActionDialog
        file={FILES[2] as SongFile}
        mode="tags"
        folders={[]}
        knownTags={['Logic']}
        onClose={() => {}}
      />,
    );
    const input = screen.getByLabelText('Tags');
    await userEvent.clear(input);
    await userEvent.type(input, 'Logic, logic , drums,');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/assets/D',
      expect.objectContaining({ body: JSON.stringify({ tags: ['Logic', 'drums'] }) }),
    );
    unmount();

    render(
      <FileActionDialog
        file={FILES[2] as SongFile}
        mode="trash"
        folders={[]}
        knownTags={[]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/can be restored/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/assets/D',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refuses an unsafe folder before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <FileActionDialog
        file={FILES[2] as SongFile}
        mode="move"
        folders={[]}
        knownTags={[]}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByLabelText('Folder'), '../outside');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/can’t be stored/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers the actions menu only to someone who may edit', () => {
    render(<ProjectFiles files={FILES} canEdit knownTags={[]} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Actions for Drums.mid' })).toBeInTheDocument();
  });
});
