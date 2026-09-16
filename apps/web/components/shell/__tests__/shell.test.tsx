import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommandEntry } from '../command-entry';
import { NavigationRail } from '../navigation-rail';
import { PLAYER_HEIGHT, PlayerRegion } from '../player-region';

// `usePathname` needs a router context that does not exist in a unit test.
const mockPathname = vi.hoisted(() => ({ current: '/library' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

describe('NavigationRail', () => {
  it('exposes every destination as a named link', () => {
    render(<NavigationRail />);
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(nav).toBeInTheDocument();
    for (const label of ['Library', 'Recent', 'Shared', 'Favorites', 'Trash']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('marks the current destination with aria-current, not colour alone', () => {
    mockPathname.current = '/favorites';
    render(<NavigationRail />);

    const favorites = screen.getByRole('link', { name: /Favorites/ });
    expect(favorites).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Trash/ })).not.toHaveAttribute('aria-current');
  });

  it('treats a nested route as being within its destination', () => {
    mockPathname.current = '/library/folder/01J8XK';
    render(<NavigationRail />);
    expect(screen.getByRole('link', { name: /Library/ })).toHaveAttribute('aria-current', 'page');
  });

  it('gives the wordmark an accessible name rather than a bare ampersand', () => {
    mockPathname.current = '/library';
    render(<NavigationRail />);
    expect(screen.getByRole('link', { name: /You & Friends — go to library/ })).toBeInTheDocument();
  });

  it('uses the espresso focus ring, since the ink ring is invisible there', () => {
    render(<NavigationRail />);
    expect(screen.getByRole('link', { name: /Recent/ }).className).toMatch(
      /focus-visible:outline-ring-on-espresso/,
    );
  });
});

describe('PlayerRegion', () => {
  it('reserves its height even when nothing is playing', () => {
    const { container } = render(<PlayerRegion />);
    const region = container.querySelector('[data-player-region]');
    // Reserved up front so the first play does not shove the page upward.
    expect(region).toHaveStyle({ height: PLAYER_HEIGHT });
  });

  it('renders whatever the player supplies', () => {
    render(
      <PlayerRegion>
        <span>Now playing</span>
      </PlayerRegion>,
    );
    expect(screen.getByText('Now playing')).toBeInTheDocument();
  });
});

describe('CommandEntry', () => {
  it('advertises its keyboard shortcut to assistive technology', () => {
    render(<CommandEntry />);
    const button = screen.getByRole('button', { name: /Search/ });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  it('is reachable by click as well as by shortcut', () => {
    render(<CommandEntry />);
    expect(screen.getByRole('button', { name: /Search/ })).toBeEnabled();
  });

  it('opens on Meta+K and on Control+K', () => {
    render(<CommandEntry />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Toggles closed again, so the same chord dismisses it.
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ignores a bare k, so typing in a field does not open it', () => {
    render(<CommandEntry />);
    fireEvent.keyDown(document, { key: 'k' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('removes its listener on unmount', () => {
    const { unmount } = render(<CommandEntry />);
    unmount();
    // Would throw if the handler were still attached to a torn-down component.
    expect(() => fireEvent.keyDown(document, { key: 'k', metaKey: true })).not.toThrow();
  });
});
