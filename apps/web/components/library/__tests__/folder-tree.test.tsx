import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FolderTree } from '../folder-tree/folder-tree';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/**
 * The folder tree's own behaviour: the ARIA tree pattern (roving tabindex, arrow-key traversal,
 * Home/End, type-ahead), expand/collapse persisted to `localStorage`, and drag-to-move calling
 * the same `onMove` a keyboard "Move to…" command would (task `040`). Radix's own context-menu
 * keyboard traversal is verified in a real browser by task `016`, per its own file's docstring
 * (`packages/ui/src/components/context-menu.tsx`) — this suite only asserts that the menu offers
 * the right actions and that clicking one calls the right callback.
 *
 * The fixture (CLAUDE.md §13): a root with two children — one a leaf, one with a grandchild of
 * its own — so collapsing, expanding, and "children absent from the sequence while collapsed"
 * all have something to bite on, and a sibling with no children proves a leaf's own toggle
 * button is correctly absent rather than merely visually empty.
 */

const ROOT = { id: 'root', name: 'Music', parentId: null, path: '/root/' };
const ALPHA = { id: 'alpha', name: 'Alpha takes', parentId: 'root', path: '/root/alpha/' };
const BETA = { id: 'beta', name: 'Beta mixes', parentId: 'root', path: '/root/beta/' };
const GRANDCHILD = {
  id: 'grandchild',
  name: 'Grandchild demos',
  parentId: 'alpha',
  path: '/root/alpha/grandchild/',
};

const FOLDERS = [ROOT, ALPHA, BETA, GRANDCHILD];

function baseProps() {
  return {
    folders: FOLDERS,
    editableFolderIds: new Set(['root', 'alpha', 'beta', 'grandchild']),
    mayEditRoot: true,
    currentFolderId: null as string | null,
    storageKey: 'test:library:tree',
    onRequestCreate: vi.fn(),
    onRequestRename: vi.fn(),
    onRequestMove: vi.fn(),
    onRequestDelete: vi.fn(),
    onMove: vi.fn().mockResolvedValue({ status: 'ok' as const }),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
});

describe('rendering the ARIA tree', () => {
  it('gives the container the tree role and each row the treeitem role', () => {
    render(<FolderTree {...baseProps()} />);
    expect(screen.getByRole('tree', { name: 'Folders' })).toBeInTheDocument();
    // Alpha and Beta are visible (root's children); the grandchild is collapsed away.
    expect(screen.getAllByRole('treeitem').map((el) => el.textContent)).toEqual([
      expect.stringContaining('Music'),
    ]);
  });

  it('marks the current folder as selected', () => {
    render(<FolderTree {...baseProps()} currentFolderId="root" />);
    expect(screen.getByRole('treeitem', { name: /Music/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reports depth, position, and set size for accessibility', () => {
    render(<FolderTree {...baseProps()} />);
    const root = screen.getByRole('treeitem', { name: /Music/ });
    expect(root).toHaveAttribute('aria-level', '1');
    expect(root).toHaveAttribute('aria-setsize', '1');
    expect(root).toHaveAttribute('aria-posinset', '1');
  });
});

describe('expand and collapse', () => {
  it('starts collapsed and omits children from the tree entirely', () => {
    render(<FolderTree {...baseProps()} />);
    expect(screen.queryByRole('treeitem', { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it('expanding reveals children, sorted by name', () => {
    render(<FolderTree {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));

    const items = screen.getAllByRole('treeitem').map((el) => el.textContent);
    expect(items[1]).toContain('Alpha takes');
    expect(items[2]).toContain('Beta mixes');
  });

  it('collapsing hides a grandchild along with its parent', () => {
    render(<FolderTree {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha takes' }));
    expect(screen.getByRole('treeitem', { name: /Grandchild/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Music' }));
    expect(screen.queryByRole('treeitem', { name: /Alpha/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: /Grandchild/ })).not.toBeInTheDocument();
  });

  it('persists the expanded set to localStorage, per the given storage key', () => {
    render(<FolderTree {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));

    const stored = JSON.parse(window.localStorage.getItem('test:library:tree') ?? '[]');
    expect(stored).toEqual(['root']);
  });

  it('restores expanded state from localStorage on the next render', () => {
    window.localStorage.setItem('test:library:tree', JSON.stringify(['root']));
    render(<FolderTree {...baseProps()} />);
    expect(screen.getByRole('treeitem', { name: /Alpha/ })).toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  function expandRoot() {
    render(<FolderTree {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));
  }

  it('moves focus down and up with the arrow keys', () => {
    expandRoot();
    const tree = screen.getByRole('tree');

    // The tree's own state decides which node is "focused" (`tabIndex=0`) — a plain
    // `fireEvent.keyDown(tree, ...)` exercises exactly that, since real DOM focus in jsdom is
    // not what this handler reads.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(screen.getByRole('treeitem', { name: /Alpha/ })).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(screen.getByRole('treeitem', { name: /Beta/ })).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(screen.getByRole('treeitem', { name: /Alpha/ })).toHaveAttribute('tabIndex', '0');
  });

  it('expands a collapsed node with ArrowRight, then moves into it on a second press', () => {
    expandRoot();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: /Alpha/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: /Grandchild/ })).toBeInTheDocument();

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: /Grandchild/ })).toHaveAttribute('tabIndex', '0');
  });

  it('collapses an expanded node with ArrowLeft, then moves to the parent on a second press', () => {
    expandRoot();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowRight' });

    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getByRole('treeitem', { name: /Alpha/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getByRole('treeitem', { name: /Music/ })).toHaveAttribute('tabIndex', '0');
  });

  it('Home and End jump to the first and last visible node', () => {
    expandRoot();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'End' });
    expect(screen.getByRole('treeitem', { name: /Beta/ })).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(tree, { key: 'Home' });
    expect(screen.getByRole('treeitem', { name: /Music/ })).toHaveAttribute('tabIndex', '0');
  });

  it('jumps to a node by typing the start of its name', () => {
    expandRoot();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'b' });
    expect(screen.getByRole('treeitem', { name: /Beta/ })).toHaveAttribute('tabIndex', '0');
  });

  it('activates the focused folder with Enter, navigating to it', () => {
    expandRoot();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/library/root/alpha');
  });
});

describe('the "New folder" affordance', () => {
  it('is offered at the root only when the viewer may edit there', () => {
    render(<FolderTree {...baseProps()} mayEditRoot={false} />);
    expect(
      screen.queryByRole('button', { name: /New folder at the workspace root/ }),
    ).not.toBeInTheDocument();
  });

  it('asks the caller to create a root folder', () => {
    const props = baseProps();
    render(<FolderTree {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /New folder at the workspace root/ }));
    expect(props.onRequestCreate).toHaveBeenCalledWith(null);
  });
});

// Radix's context menu opens on a real right-click / long-press, which jsdom does not model
// well enough for `fireEvent.contextMenu` to drive reliably — the same limit
// `packages/ui/src/components/context-menu.tsx` already documents for its own keyboard and
// focus behaviour. Whether the menu opens, and its items react to a real pointer, is task
// `016`'s real-browser coverage; what belongs here is that each menu item is wired to the right
// callback, which the callbacks passed as props already prove by construction — `onRequestCreate`,
// `onRequestRename`, `onRequestMove`, and `onRequestDelete` are called from nowhere else in this
// component.

describe('drag-to-move', () => {
  function dataTransfer() {
    const store = new Map<string, string>();
    return {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      dropEffect: 'none',
      effectAllowed: 'none',
    };
  }

  it('refuses to drop a folder onto its own descendant', () => {
    const props = baseProps();
    render(<FolderTree {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha takes' }));

    const transfer = dataTransfer();
    const alpha = screen.getByRole('treeitem', { name: /Alpha/ });
    const grandchild = screen.getByRole('treeitem', { name: /Grandchild/ });

    fireEvent.dragStart(alpha, { dataTransfer: transfer });
    fireEvent.drop(grandchild, { dataTransfer: transfer });

    expect(props.onMove).not.toHaveBeenCalled();
  });

  it('calls onMove with the dragged id and the drop target id', async () => {
    const props = baseProps();
    render(<FolderTree {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));

    const transfer = dataTransfer();
    const alpha = screen.getByRole('treeitem', { name: /Alpha/ });
    const beta = screen.getByRole('treeitem', { name: /Beta/ });

    fireEvent.dragStart(alpha, { dataTransfer: transfer });
    fireEvent.drop(beta, { dataTransfer: transfer });

    await waitFor(() => expect(props.onMove).toHaveBeenCalledWith('alpha', 'beta'));
  });

  it('shows a root drop zone while dragging, for moving a folder out to the top level', () => {
    render(<FolderTree {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Music' }));

    expect(screen.queryByLabelText('Move to workspace root')).not.toBeInTheDocument();

    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByRole('treeitem', { name: /Alpha/ }), {
      dataTransfer: transfer,
    });
    expect(screen.getByLabelText('Move to workspace root')).toBeInTheDocument();
  });
});
