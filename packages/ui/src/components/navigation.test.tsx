/**
 * Tabs and display primitives.
 *
 * Split by group so Vitest isolates them: a dialog test leaves scroll-lock and aria-hidden
 * residue on the document that broke unrelated tests later in the same file.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';
import { Avatar, AvatarFallback, Separator, Skeleton } from './display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('Tabs', () => {
  function SongTabs() {
    return (
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="lyrics">Lyrics panel</TabsContent>
      </Tabs>
    );
  }

  it('marks the active tab by more than colour and shows its panel', () => {
    render(<SongTabs />);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    // A border and a weight change accompany the colour (docs/DESIGN.md §12).
    expect(overview.className).toMatch(/data-\[state=active\]:border-primary/);
    expect(overview.className).toMatch(/data-\[state=active\]:font-medium/);
    expect(screen.getByText('Overview panel')).toBeInTheDocument();
  });

  it('switches panels when another tab is activated', () => {
    render(<SongTabs />);

    // Radix activates a tab on mousedown, not click — a click alone leaves it unselected.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Lyrics' }));

    expect(screen.getByRole('tab', { name: 'Lyrics' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Lyrics panel')).toBeInTheDocument();
    expect(screen.queryByText('Overview panel')).not.toBeInTheDocument();
  });

  it('associates each tab with its panel for assistive technology', () => {
    render(<SongTabs />);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    const panelId = overview.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', panelId!);
  });

  it('exposes the tab list as a tablist', () => {
    render(<SongTabs />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});

describe('Display primitives', () => {
  it('renders an avatar fallback when there is no image', () => {
    render(
      <Avatar>
        <AvatarFallback>AV</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
  });

  it('hides a decorative separator from assistive technology', () => {
    render(<Separator data-testid="sep" />);
    expect(screen.getByTestId('sep')).toHaveAttribute('data-orientation', 'horizontal');
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('exposes a real separator when it is not decorative', () => {
    render(<Separator decorative={false} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('hides skeletons from assistive technology', () => {
    render(<Skeleton data-testid="sk" className="h-4 w-20" />);
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true');
  });

  it('pairs badge colour with text rather than colour alone', () => {
    render(<Badge variant="problem">Failed</Badge>);
    // The word carries the meaning; the colour only reinforces it.
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
