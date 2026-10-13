import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './components/button';
import { Input } from './components/input';
import { Tabs, TabsList, TabsTrigger } from './components/tabs';

/**
 * Below the `md` breakpoint every primitive control reaches the 44×44 px touch target
 * (`docs/DESIGN.md` §12, task `101`). jsdom has no layout, so this asserts the classes that
 * produce the size; `docs/RESPONSIVE_CHECKLIST.md` records the browser check (task `104`).
 */
describe('touch targets on a phone (task 101)', () => {
  it.each(['sm', 'md', 'lg'] as const)('a %s button is at least 44 px tall', (size) => {
    render(<Button size={size}>Save</Button>);
    expect(screen.getByRole('button').className).toMatch(/(max-md:min-h-11|\bh-11\b)/);
  });

  it('an icon button is 44 px square', () => {
    render(<Button size="icon" aria-label="More" />);
    expect(screen.getByRole('button').className).toContain('max-md:size-11');
  });

  it('a text field is 44 px tall', () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole('textbox').className).toContain('max-md:h-11');
  });

  it('a tab is 44 px tall', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Overview</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole('tab').className).toContain('max-md:min-h-11');
  });
});
