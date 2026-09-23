import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MoveToDialog } from '../folder-tree/move-to-dialog';
import type { VisibleFolder } from '@/lib/library/tree';

/**
 * The keyboard-accessible "Move to…" alternative to drag-and-drop (task `040`'s own
 * requirement). Like `NameDialog`, this is a plain Radix `Dialog`, directly testable — the
 * destination-filtering logic it duplicates client-side from `moveLibraryFolder` is exactly
 * the thing worth pinning here, since an invalid choice being *offered* is a worse failure mode
 * than one being refused after the fact.
 */

const ROOT: VisibleFolder = { id: 'root', name: 'Root', parentId: null, path: '/root/' };
const PARENT: VisibleFolder = {
  id: 'parent',
  name: 'Current parent',
  parentId: 'root',
  path: '/root/parent/',
};
const FOLDER: VisibleFolder = {
  id: 'folder',
  name: 'Moving me',
  parentId: 'parent',
  path: '/root/parent/folder/',
};
const CHILD: VisibleFolder = {
  id: 'child',
  name: 'My own child',
  parentId: 'folder',
  path: '/root/parent/folder/child/',
};
const SIBLING: VisibleFolder = {
  id: 'sibling',
  name: 'Unrelated sibling',
  parentId: 'root',
  path: '/root/sibling/',
};
const NOT_EDITABLE: VisibleFolder = {
  id: 'locked',
  name: 'Not mine to edit',
  parentId: 'root',
  path: '/root/locked/',
};

const ALL_FOLDERS = [ROOT, PARENT, FOLDER, CHILD, SIBLING, NOT_EDITABLE];

function baseProps() {
  return {
    folder: FOLDER,
    folders: ALL_FOLDERS,
    editableFolderIds: new Set(['root', 'parent', 'folder', 'child', 'sibling']),
    mayMoveToRoot: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue({ status: 'ok' as const }),
  };
}

describe('MoveToDialog', () => {
  it('names the folder being moved', () => {
    render(<MoveToDialog {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'Move “Moving me”' })).toBeInTheDocument();
  });

  it('excludes the folder itself and its own descendant from the destination list', () => {
    render(<MoveToDialog {...baseProps()} />);
    const list = screen.getByRole('list');
    expect(within(list).queryByText('Moving me')).not.toBeInTheDocument();
    expect(within(list).queryByText('My own child')).not.toBeInTheDocument();
  });

  it('excludes a folder this viewer may not edit', () => {
    render(<MoveToDialog {...baseProps()} />);
    expect(screen.queryByText('Not mine to edit')).not.toBeInTheDocument();
  });

  it('offers an unrelated editable folder as a destination', () => {
    render(<MoveToDialog {...baseProps()} />);
    expect(screen.getByText('Unrelated sibling')).toBeInTheDocument();
  });

  it('offers the workspace root when the folder is not already there', () => {
    render(<MoveToDialog {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Workspace root/ })).toBeInTheDocument();
  });

  it('omits the workspace root option when the folder is already at the root', () => {
    render(<MoveToDialog {...baseProps()} folder={ROOT} />);
    expect(screen.queryByRole('button', { name: /Workspace root/ })).not.toBeInTheDocument();
  });

  it('disables the row for the folder’s current parent', () => {
    render(<MoveToDialog {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Current parent/ })).toBeDisabled();
  });

  it('moves to the chosen destination and closes on success', async () => {
    const props = baseProps();
    render(<MoveToDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Unrelated sibling/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('sibling'));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('moves to the workspace root when that option is chosen', async () => {
    const props = baseProps();
    render(<MoveToDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Workspace root/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith(null));
  });

  it('shows the server error and stays open when the move fails', async () => {
    const props = baseProps();
    props.onSubmit.mockResolvedValue({ status: 'error', message: 'Cannot move there.' });
    render(<MoveToDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Unrelated sibling/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot move there.');
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('cancels without submitting', () => {
    const props = baseProps();
    render(<MoveToDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('says so when there is nowhere else to move to', () => {
    render(
      <MoveToDialog
        {...baseProps()}
        folders={[FOLDER]}
        editableFolderIds={new Set(['folder'])}
        mayMoveToRoot={false}
      />,
    );
    expect(
      screen.getByText('There is nowhere else you can move this folder to.'),
    ).toBeInTheDocument();
  });
});
