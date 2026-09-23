import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NameDialog } from '../folder-tree/name-dialog';

/**
 * The shared "New folder"/"Rename" dialog (task `040`): a plain Radix `Dialog`, not a
 * context/dropdown menu, so — unlike `folder-tree.test.tsx`'s deferred-to-task-`016` carve-out
 * for right-click menus — its `open` state and form interaction are directly testable in jsdom.
 */

function baseProps() {
  return {
    title: 'New folder',
    description: 'Name the new folder.',
    confirmLabel: 'Create',
    onOpenChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue({ status: 'ok' as const }),
  };
}

describe('NameDialog', () => {
  it('renders the given title, description, and confirm label', () => {
    render(<NameDialog {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'New folder' })).toBeInTheDocument();
    expect(screen.getByText('Name the new folder.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('pre-fills the name from initialName, for renaming', () => {
    render(<NameDialog {...baseProps()} initialName="Old name" />);
    expect(screen.getByLabelText('Folder name')).toHaveValue('Old name');
  });

  it('disables the confirm button while the name is empty', () => {
    render(<NameDialog {...baseProps()} initialName="" />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('enables the confirm button once a name is typed', () => {
    render(<NameDialog {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Demos' } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('submits the typed name and closes on success', async () => {
    const props = baseProps();
    render(<NameDialog {...props} />);

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Demos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('Demos'));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the server error and stays open when the submission fails', async () => {
    const props = baseProps();
    props.onSubmit.mockResolvedValue({ status: 'error', message: 'That name is already used.' });
    render(<NameDialog {...props} />);

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Demos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already used.');
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('cancels without submitting', () => {
    const props = baseProps();
    render(<NameDialog {...props} initialName="Something" />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
