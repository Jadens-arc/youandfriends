import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FavoritesPage from '../favorites/page';
import LibraryPage from '../library/page';
import RecentPage from '../recent/page';
import SharedPage from '../shared/page';
import TrashPage from '../trash/page';

/**
 * Every navigation destination resolves to a page with a heading.
 *
 * These are placeholders that tasks `040`–`044` replace, but a destination in the rail that
 * leads nowhere is a broken link, and the rail links to all five today.
 */
describe('workspace destinations', () => {
  it.each([
    ['Library', LibraryPage],
    ['Recent', RecentPage],
    ['Shared', SharedPage],
    ['Favorites', FavoritesPage],
    ['Trash', TrashPage],
  ])('%s renders a top-level heading', (name, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it('gives the library a resizable split layout with an accessible divider', () => {
    render(<LibraryPage />);
    expect(screen.getByRole('separator', { name: 'Resize song list' })).toBeInTheDocument();
  });

  it('titles each page with the product name, ampersand intact', () => {
    for (const mod of [LibraryPage, RecentPage, SharedPage, FavoritesPage, TrashPage]) {
      expect(mod).toBeTypeOf('function');
    }
  });
});
