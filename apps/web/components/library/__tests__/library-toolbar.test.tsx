import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { LibraryToolbar } = await import('../library-toolbar');

/**
 * Grid/list switching and sorting (task `041`): each choice is remembered in a cookie the
 * server reads on the next render, and the page is refreshed to show it.
 */

function clearCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCookies();
});
afterEach(clearCookies);

describe('LibraryToolbar', () => {
  it('shows the current layout as pressed, by state and not by colour alone', () => {
    render(<LibraryToolbar view="grid" sort="recent" count={3} />);
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('3 projects')).toBeInTheDocument();
  });

  it('remembers a layout change and re-renders the page', () => {
    render(<LibraryToolbar view="grid" sort="recent" count={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(document.cookie).toContain('yaf-library-view=list');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 project')).toBeInTheDocument();
  });

  it('does nothing when the current layout is chosen again', () => {
    render(<LibraryToolbar view="list" sort="recent" count={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(router.refresh).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('yaf-library-view');
  });

  it.each([
    ['N', 'Name', 'name'],
    ['D', 'Date created', 'created'],
    ['A', 'Artist', 'artist'],
    ['R', 'Recent activity', 'recent'],
  ] as const)('offers “%s” → %s from the keyboard', (key, label, value) => {
    // Typeahead on the closed trigger walks the select's real item collection. Opening Radix's
    // listbox in jsdom pins the worker — its positioning never settles without layout — so the
    // open-menu path belongs with task `016`'s real-browser menu coverage.
    render(<LibraryToolbar view="list" sort={value === 'recent' ? 'name' : 'recent'} count={2} />);
    const trigger = screen.getByRole('combobox', { name: 'Sort projects by' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(trigger).toHaveTextContent(label);
    expect(document.cookie).toContain(`yaf-library-sort=${value}`);
  });

  it('remembers a sort chosen from the keyboard and re-renders the page', () => {
    render(<LibraryToolbar view="grid" sort="recent" count={2} />);
    const trigger = screen.getByRole('combobox', { name: 'Sort projects by' });
    // Typeahead on the focused, closed trigger: Radix selects the first match without opening.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'A' });
    expect(trigger).toHaveTextContent('Artist');
    expect(document.cookie).toContain('yaf-library-sort=artist');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
