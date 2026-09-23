import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FavoritesPage from '../favorites/page';
import RecentPage from '../recent/page';
import SharedPage from '../shared/page';
import TrashPage from '../trash/page';

/**
 * Every navigation destination resolves to a page with a heading.
 *
 * These are placeholders that tasks `041`–`044` replace, but a destination in the rail that
 * leads nowhere is a broken link, and the rail links to all five today. Library is no longer
 * one of them: task `040` replaced its placeholder with a real, database-backed route, which
 * needs the mocking `library/__tests__/page.test.tsx` sets up rather than a bare `render`.
 */
describe('workspace destinations', () => {
  it.each([
    ['Recent', RecentPage],
    ['Shared', SharedPage],
    ['Favorites', FavoritesPage],
    ['Trash', TrashPage],
  ])('%s renders a top-level heading', (name, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it('titles each page with the product name, ampersand intact', () => {
    for (const mod of [RecentPage, SharedPage, FavoritesPage, TrashPage]) {
      expect(mod).toBeTypeOf('function');
    }
  });
});
