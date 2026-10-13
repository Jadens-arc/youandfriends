import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from '../action-menu';

/** Answer `matchMedia` as a phone (or a desk) would. */
function setPhone(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query.includes('max-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Example({ onRename, onTrash }: { onRename: () => void; onTrash: () => void }) {
  return (
    <ActionMenu
      label="Actions for Drums.wav"
      title="Drums.wav"
      actions={[
        { key: 'rename', label: 'Rename…', onSelect: onRename },
        { key: 'trash', label: 'Move to trash…', onSelect: onTrash, destructive: true },
      ]}
    />
  );
}

describe('ActionMenu (task 103)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is a bottom sheet on a phone: full-width rows, the action runs, focus comes back', async () => {
    setPhone(true);
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(<Example onRename={onRename} onTrash={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Drums.wav' });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Drums.wav' });
    expect(sheet.querySelector('[data-drag-handle]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Rename…' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape without running anything', async () => {
    setPhone(true);
    const onTrash = vi.fn();
    const user = userEvent.setup();
    render(<Example onRename={vi.fn()} onTrash={onTrash} />);
    await user.click(screen.getByRole('button', { name: 'Actions for Drums.wav' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onTrash).not.toHaveBeenCalled();
  });

  it('is a dropdown menu on a desk, not a sheet', () => {
    // Opening a Radix menu needs a real browser (task `016`); which presentation renders does not.
    setPhone(false);
    render(<Example onRename={vi.fn()} onTrash={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Actions for Drums.wav' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
  });

  it('announces a dialog on a phone', () => {
    setPhone(true);
    render(<Example onRename={vi.fn()} onTrash={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Actions for Drums.wav' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });
});
