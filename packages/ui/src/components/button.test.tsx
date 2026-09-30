import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

/**
 * Touch targets (task `101`). jsdom cannot measure layout, so this holds the classes that give the
 * 44×44 floor on a phone; the measurement itself is in `docs/RESPONSIVE_CHECKLIST.md`.
 */
describe('Button touch targets', () => {
  it.each(['sm', 'md', 'icon'] as const)('gives the %s size 44 px on a phone', (size) => {
    render(<Button size={size}>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    const classes = button.className.split(/\s+/);
    if (size === 'icon') {
      expect(classes).toContain('max-md:size-11');
    } else {
      expect(classes).toEqual(expect.arrayContaining(['max-md:min-h-11', 'max-md:min-w-11']));
    }
  });

  it('keeps the large size at 44 px everywhere', () => {
    render(<Button size="lg">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className.split(/\s+/)).toContain('h-11');
  });
});
