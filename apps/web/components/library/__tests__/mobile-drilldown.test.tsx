import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileDrilldown } from '../folder-tree/mobile-drilldown';
import type { VisibleFolder } from '@/lib/library/tree';

/**
 * The mobile drill-down list (task `040`): what one level of the tree looks like on a phone,
 * and which folders offer the overflow menu of organize actions. Opening that menu and clicking
 * an item is a real Radix `DropdownMenu` interaction — like `folder-tree.tsx`'s context menu,
 * its keyboard/focus behaviour is task `016`'s real-browser territory
 * (`packages/ui/src/components/dropdown-menu.tsx`'s own docstring says so) — so this suite
 * covers what renders and what is wired to each prop callback, not menu-open mechanics.
 */

const READ_ONLY: VisibleFolder = {
  id: 'read-only',
  name: 'Read only',
  parentId: null,
  path: '/read-only/',
};
const EDITABLE: VisibleFolder = {
  id: 'editable',
  name: 'Editable',
  parentId: null,
  path: '/editable/',
};

function baseProps() {
  return {
    children: [READ_ONLY, EDITABLE],
    currentFolderId: null as string | null,
    editableFolderIds: new Set(['editable']),
    mayCreateHere: true,
    onRequestCreate: vi.fn(),
    onRequestRename: vi.fn(),
    onRequestMove: vi.fn(),
    onRequestDelete: vi.fn(),
  };
}

describe('MobileDrilldown', () => {
  it('lists the given folders as links into them, sorted by name', () => {
    render(<MobileDrilldown {...baseProps()} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Editable'),
      expect.stringContaining('Read only'),
    ]);
    expect(links[0]).toHaveAttribute('href', '/library/editable');
  });

  it('says so when the folder is empty', () => {
    render(<MobileDrilldown {...baseProps()} children={[]} />);
    expect(screen.getByText('This folder is empty.')).toBeInTheDocument();
  });

  it('offers the overflow menu only for a folder this viewer may edit', () => {
    render(<MobileDrilldown {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'More actions for Editable' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More actions for Read only' }),
    ).not.toBeInTheDocument();
  });

  it('offers "New folder" when the viewer may create here', () => {
    const props = baseProps();
    render(<MobileDrilldown {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(props.onRequestCreate).toHaveBeenCalledWith(null);
  });

  it('passes the current folder id as the parent for "New folder"', () => {
    const props = baseProps();
    render(<MobileDrilldown {...props} currentFolderId="editable" />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(props.onRequestCreate).toHaveBeenCalledWith('editable');
  });

  it('omits "New folder" when the viewer may not create here', () => {
    render(<MobileDrilldown {...baseProps()} mayCreateHere={false} />);
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
  });
});
