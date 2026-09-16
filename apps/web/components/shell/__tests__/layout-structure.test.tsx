import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The shell's central guarantee is structural: playback survives navigation because the
 * player region is a SIBLING of the route segment in the layout tree, not a descendant of a
 * page. Next.js re-renders only the changed segment, so the audio element is never unmounted.
 *
 * That property cannot be observed by rendering a component — it is a property of where the
 * component sits in the App Router tree. These assertions read the layout source, which is
 * the thing that would have to change for the guarantee to break. The behaviour itself is
 * verified by navigating in a real browser in task `120`.
 */
const rawLayout = readFileSync(resolve(process.cwd(), 'app/(workspace)/layout.tsx'), 'utf8');

/**
 * Comments are stripped before the structure is inspected.
 *
 * The first version of this test matched `{children}` inside the layout's own doc comment,
 * which sits above the JSX, and concluded the ordering was wrong. Analysing prose as if it
 * were code is exactly the kind of false signal that erodes trust in a test.
 */
const layoutSource = rawLayout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('workspace layout structure', () => {
  it('renders the player region in the layout, not in a page', () => {
    expect(layoutSource).toContain('<PlayerRegion />');
  });

  it('renders the navigation rail in the layout', () => {
    expect(layoutSource).toContain('<NavigationRail />');
  });

  it('confines {children} to a main region that is a sibling of the player', () => {
    const childrenIndex = layoutSource.indexOf('{children}');
    const playerIndex = layoutSource.indexOf('<PlayerRegion />');
    const railIndex = layoutSource.indexOf('<NavigationRail />');

    expect(childrenIndex).toBeGreaterThan(-1);
    // The rail precedes the route segment and the player follows it: both are siblings, so
    // neither is inside the part Next.js swaps on navigation.
    expect(railIndex).toBeLessThan(childrenIndex);
    expect(playerIndex).toBeGreaterThan(childrenIndex);

    // And {children} is not nested inside the player region.
    const between = layoutSource.slice(childrenIndex, playerIndex);
    expect(between).not.toContain('<PlayerRegion');
  });

  it('applies the paper grain once at the shell rather than per card', () => {
    expect(layoutSource).toContain('paper-grain');
    expect(layoutSource.match(/paper-grain/g)).toHaveLength(1);
  });
});
