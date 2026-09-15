import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Home from './page';

describe('landing surface', () => {
  it('renders the product name with the ampersand', () => {
    render(<Home />);
    // getByRole reads the accessible name, so this also asserts the heading is reachable.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You & Friends');
  });

  it('shows the tagline and attribution', () => {
    render(<Home />);
    expect(screen.getByText('Where songs live between sessions.')).toBeInTheDocument();
    expect(screen.getByText(/by Avery and Friends/)).toBeInTheDocument();
  });

  it('never renders the product name without the ampersand', () => {
    const { container } = render(<Home />);
    expect(container.textContent).not.toMatch(/You and Friends/);
  });
});
