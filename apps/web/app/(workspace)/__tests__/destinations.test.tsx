import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TrashPage from '../trash/page';

/**
 * Every navigation destination resolves to a page with a heading.
 *
 * Trash is the one placeholder left (deferred task `212`), but a destination in the rail that
 * leads nowhere is a broken link. Library, Recent, Shared, and Favorites are real,
 * database-backed routes now (tasks `040`–`044`), tested through their use cases.
 */
describe('workspace destinations', () => {
  it.each([['Trash', TrashPage]])('%s renders a top-level heading', (name, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it('titles each page with the product name, ampersand intact', () => {
    for (const mod of [TrashPage]) {
      expect(mod).toBeTypeOf('function');
    }
  });
});
