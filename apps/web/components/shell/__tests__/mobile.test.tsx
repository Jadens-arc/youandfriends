import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BottomNavigation } from '../mobile/bottom-navigation';
import { MobileHeader } from '../mobile/mobile-header';
import { MINI_PLAYER_HEIGHT, MiniPlayer } from '../mobile/mini-player';

const mockPathname = vi.hoisted(() => ({ current: '/library' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

describe('BottomNavigation', () => {
  it('offers five destinations, each a named link', () => {
    render(<BottomNavigation />);
    const links = screen.getAllByRole('link');
    // Five is the ceiling: a sixth makes each target too narrow for a thumb.
    expect(links).toHaveLength(5);
    for (const label of ['Library', 'Recent', 'Search', 'Shared', 'Favorites']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the current destination with aria-current, not colour alone', () => {
    mockPathname.current = '/recent';
    render(<BottomNavigation />);
    expect(screen.getByRole('link', { name: 'Recent' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current');
  });

  it('treats a nested route as being within its destination', () => {
    mockPathname.current = '/library/folder/01J8XK';
    render(<BottomNavigation />);
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
  });

  it('meets the 44px minimum touch target on every destination', () => {
    mockPathname.current = '/library';
    render(<BottomNavigation />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toMatch(/min-h-11/);
      expect(link.className).toMatch(/min-w-11/);
    }
  });

  it('clears the home indicator', () => {
    render(<BottomNavigation />);
    // Without this the bar sits under it and the bottom row of targets becomes unreliable.
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(nav.className).toMatch(/safe-area-inset-bottom/);
  });

  it('uses the espresso focus ring, since the ink ring is invisible there', () => {
    render(<BottomNavigation />);
    expect(screen.getByRole('link', { name: 'Shared' }).className).toMatch(
      /focus-visible:outline-ring-on-espresso/,
    );
  });
});

describe('MiniPlayer', () => {
  it('reserves its height so content can clear it', () => {
    const { container } = render(<MiniPlayer />);
    expect(container.querySelector('[data-mini-player]')).toHaveStyle({
      height: MINI_PLAYER_HEIGHT,
    });
  });

  it('offers expand as a button, not a gesture alone', () => {
    render(<MiniPlayer />);
    // A swipe-only affordance would fight iOS Safari's edge-swipe back gesture and would be
    // unreachable by keyboard and screen reader.
    const expand = screen.getByRole('button', { name: 'Expand player' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the expanded player and reports the change', () => {
    render(<MiniPlayer />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand player' }));

    expect(screen.getByRole('dialog', { name: 'Player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    // The modal marks the rest of the page aria-hidden, so the trigger is only reachable
    // with `hidden` — that it is hidden is itself the correct behaviour.
    expect(screen.getByRole('button', { name: 'Expand player', hidden: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('gives every control a 44px target', () => {
    render(<MiniPlayer />);
    for (const name of ['Play', 'Expand player']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/size-11/);
    }
  });

  it('marks the transport disabled while there is nothing to play', () => {
    render(<MiniPlayer />);
    // Honest state: no audio exists until task 070, and a live-looking control that does
    // nothing is worse than one that says so.
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});

describe('MobileHeader', () => {
  it('titles a root destination rather than offering a pointless back', () => {
    mockPathname.current = '/library';
    render(<MobileHeader />);

    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers a back affordance once drilled in', () => {
    mockPathname.current = '/library/01J8XK';
    render(<MobileHeader />);

    const back = screen.getByRole('link', { name: 'Back to Library' });
    expect(back).toHaveAttribute('href', '/library');
    expect(back.className).toMatch(/min-h-11/);
  });

  it('goes up exactly one level from a deep drill-down', () => {
    mockPathname.current = '/library/01J8XK/01J8XM';
    render(<MobileHeader />);

    // A link to the parent, not a history pop: opening a song from a share link or a
    // refresh leaves no in-app entry to pop back to, and `router.back()` would leave the
    // workspace entirely.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/library/01J8XK');
  });

  it('clears the notch', () => {
    mockPathname.current = '/library';
    const { container } = render(<MobileHeader />);
    const header = container.querySelector('header');

    expect(header?.className).toMatch(/safe-area-inset-top/);
    // Desktop has the rail and the command bar; two headers would be one too many.
    expect(header?.className).toMatch(/md:hidden/);
  });
});
