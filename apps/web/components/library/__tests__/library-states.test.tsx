import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyFolderState, FirstRunState } from '../empty-states';
import { LibrarySkeleton, SKELETON_COUNT } from '../library-skeleton';
import { GRID_CLASSES, LIST_CLASSES } from '../project-grid';

/** First-run, empty-folder, and loading states for the project library (task `041`). */

describe('FirstRunState', () => {
  it('invites rather than apologizes, and offers no button that goes nowhere', () => {
    render(<FirstRunState />);
    expect(screen.getByRole('heading', { name: 'Your shelf is ready' })).toBeInTheDocument();
    expect(screen.getByText(/Bring in your first song/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('carries the upload call to action once there is one to carry', () => {
    render(<FirstRunState uploadAction={<button type="button">Upload a song</button>} />);
    expect(screen.getByRole('button', { name: 'Upload a song' })).toBeInTheDocument();
  });
});

describe('EmptyFolderState', () => {
  it('names the folder', () => {
    render(<EmptyFolderState folderName="B-sides" />);
    expect(screen.getByText('Nothing filed in B-sides yet')).toBeInTheDocument();
  });
});

describe('LibrarySkeleton', () => {
  it('occupies the same grid as the real cards, with a square cover in each', () => {
    const { container } = render(<LibrarySkeleton view="grid" />);
    const list = container.querySelector('ul');
    expect(list?.className).toBe(GRID_CLASSES);
    const items = screen.getAllByTestId('project-skeleton');
    expect(items).toHaveLength(SKELETON_COUNT);
    expect(items[0]?.querySelector('.aspect-square')).not.toBeNull();
    // The card's own metadata row has `min-h-6`; the skeleton's must match it.
    expect(items[0]?.querySelector('.min-h-6')).not.toBeNull();
  });

  it('matches list mode too', () => {
    const { container } = render(<LibrarySkeleton view="list" />);
    expect(container.querySelector('ul')?.className).toBe(LIST_CLASSES);
  });

  it('tells assistive technology it is loading, and hides the blocks themselves', () => {
    render(<LibrarySkeleton />);
    const status = screen.getByRole('status', { name: 'Loading projects' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(within(status).queryByRole('list')).toBeNull();
  });
});
