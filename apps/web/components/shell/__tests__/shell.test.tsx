import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandEntry } from '../command-entry';
import { NavigationRail } from '../navigation-rail';
import { PLAYER_HEIGHT, PlayerRegion } from '../player-region';

// `usePathname` needs a router context that does not exist in a unit test.
const mockPathname = vi.hoisted(() => ({ current: '/library' }));
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

  it('reaches settings, and marks it current anywhere beneath it', () => {
    mockPathname.current = '/settings/members';
    render(<NavigationRail />);

    const settings = screen.getByRole('link', { name: /Settings/ });
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Library/ })).not.toHaveAttribute('aria-current');
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
  // The palette asks for recent items when it opens.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              query: '',
              projects: [],
              songs: [],
              lyrics: [],
              files: [],
              recent: [],
            }),
          ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const palette = () => screen.queryByRole('dialog', { name: 'Search and commands' });

  it('advertises its keyboard shortcut to assistive technology', () => {
    render(<CommandEntry />);
    const button = screen.getByRole('button', { name: /Search/ });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  it('is reachable by click as well as by shortcut', () => {
    render(<CommandEntry />);
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(palette()).toBeInTheDocument();
  });

  it('opens on Meta+K and on Control+K', () => {
    render(<CommandEntry />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(palette()).toBeInTheDocument();

    // Toggles closed again, so the same chord dismisses it.
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(palette()).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(palette()).toBeInTheDocument();
  });

  it('ignores a bare k, so typing in a field does not open it', () => {
    render(<CommandEntry />);
    fireEvent.keyDown(document, { key: 'k' });
    expect(palette()).not.toBeInTheDocument();
  });

  it('removes its listener on unmount', () => {
    const { unmount } = render(<CommandEntry />);
    unmount();
    // Would throw if the handler were still attached to a torn-down component.
    expect(() => fireEvent.keyDown(document, { key: 'k', metaKey: true })).not.toThrow();
  });
});
