/**
 * Split pane.
 *
 * The keyboard path is the point of these tests. A divider that only responds to a mouse
 * would make the desktop project layout unadjustable for keyboard users — and because the
 * position persists, an unusable default would stay unusable (docs/DESIGN.md §12).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SplitPane } from './split-pane';

function renderPane(props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
  return render(
    <SplitPane
      label="Resize song list"
      start={<div>Song list</div>}
      end={<div>Song detail</div>}
      {...props}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('structure', () => {
  it('renders both panes', () => {
    renderPane();
    expect(screen.getByText('Song list')).toBeInTheDocument();
    expect(screen.getByText('Song detail')).toBeInTheDocument();
  });

  it('exposes the divider as a named separator with an announced value', () => {
    renderPane({ defaultPercent: 40, minPercent: 20, maxPercent: 60 });
    const divider = screen.getByRole('separator', { name: 'Resize song list' });
    expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    expect(divider).toHaveAttribute('aria-valuenow', '40');
    expect(divider).toHaveAttribute('aria-valuemin', '20');
    expect(divider).toHaveAttribute('aria-valuemax', '60');
  });

  it('puts the divider in the tab order', () => {
    renderPane();
    expect(screen.getByRole('separator')).toHaveAttribute('tabindex', '0');
  });
});

describe('keyboard resizing', () => {
  it('moves in small steps with arrow keys', () => {
    renderPane({ defaultPercent: 40 });
    const divider = screen.getByRole('separator');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider).toHaveAttribute('aria-valuenow', '42');

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '38');
  });

  it('moves in larger steps with Shift held', () => {
    renderPane({ defaultPercent: 40 });
    const divider = screen.getByRole('separator');

    fireEvent.keyDown(divider, { key: 'ArrowRight', shiftKey: true });
    expect(divider).toHaveAttribute('aria-valuenow', '50');
  });

  it('jumps to the bounds with Home and End', () => {
    renderPane({ defaultPercent: 40, minPercent: 25, maxPercent: 55 });
    const divider = screen.getByRole('separator');

    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider).toHaveAttribute('aria-valuenow', '25');

    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider).toHaveAttribute('aria-valuenow', '55');
  });

  it('clamps rather than running past its bounds', () => {
    renderPane({ defaultPercent: 24, minPercent: 22, maxPercent: 60 });
    const divider = screen.getByRole('separator');

    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '22');
  });

  it('ignores keys it does not handle', () => {
    renderPane({ defaultPercent: 40 });
    const divider = screen.getByRole('separator');
    fireEvent.keyDown(divider, { key: 'a' });
    expect(divider).toHaveAttribute('aria-valuenow', '40');
  });
});

describe('persistence', () => {
  it('remembers the position per user, not per session', () => {
    const key = 'youandfriends:test:split';
    const { unmount } = renderPane({ defaultPercent: 40, storageKey: key });

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(window.localStorage.getItem(key)).toBe('42');
    unmount();

    renderPane({ defaultPercent: 40, storageKey: key });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '42');
  });

  it('clamps a stored value that falls outside the current bounds', () => {
    const key = 'youandfriends:test:split';
    window.localStorage.setItem(key, '95');
    renderPane({ defaultPercent: 40, minPercent: 22, maxPercent: 60, storageKey: key });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '60');
  });

  it('ignores a corrupt stored value rather than rendering NaN', () => {
    const key = 'youandfriends:test:split';
    window.localStorage.setItem(key, 'not-a-number');
    renderPane({ defaultPercent: 40, storageKey: key });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '40');
  });

  it('survives storage being unavailable, as it is in private browsing', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('access denied');
    };
    try {
      // A forgotten divider position must never break the page.
      expect(() => renderPane({ storageKey: 'youandfriends:test:split' })).not.toThrow();
      expect(screen.getByText('Song list')).toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('does not touch storage when no key is given', () => {
    renderPane({ defaultPercent: 40 });
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(window.localStorage.length).toBe(0);
  });
});
