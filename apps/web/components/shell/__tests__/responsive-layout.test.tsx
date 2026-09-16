import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The responsive shell's guarantees are structural, like the desktop shell's, so they are
 * asserted against the layout source. Rendering cannot show them: a media query has no effect
 * in jsdom, and the property that matters is *where* elements sit in the App Router tree.
 *
 * Real viewport behaviour is verified in a browser by task `120`.
 */
const raw = readFileSync(resolve(process.cwd(), 'app/(workspace)/layout.tsx'), 'utf8');
const layout = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('responsive workspace layout', () => {
  it('renders both desktop and mobile chrome, switching with CSS', () => {
    // Branching on a measured viewport would unmount and remount the player when the
    // breakpoint is crossed — on an orientation change, say — which is the exact failure
    // the shell exists to prevent.
    expect(layout).toContain('<NavigationRail />');
    expect(layout).toContain('<MobileHeader />');
    expect(layout).toContain('<BottomNavigation />');
    expect(layout).toContain('<MiniPlayer />');
    expect(layout).toContain('<PlayerRegion />');
    expect(layout).toMatch(/md:hidden/);
    expect(layout).toMatch(/hidden md:/);
  });

  it('does not branch on a JavaScript viewport measurement', () => {
    for (const forbidden of ['useMediaQuery', 'window.innerWidth', 'matchMedia']) {
      expect(layout).not.toContain(forbidden);
    }
  });

  it('keeps every navigation and player element a sibling of the route segment', () => {
    const childrenIndex = layout.indexOf('{children}');
    expect(childrenIndex).toBeGreaterThan(-1);

    // Nothing that must survive navigation may sit inside the swapped segment.
    const mainOpen = layout.indexOf('<main');
    const mainClose = layout.indexOf('</main>');
    const insideMain = layout.slice(mainOpen, mainClose);
    for (const element of [
      '<NavigationRail',
      '<MobileHeader',
      '<BottomNavigation',
      '<MiniPlayer',
      '<PlayerRegion',
    ]) {
      expect(insideMain).not.toContain(element);
    }
  });

  it('uses dynamic viewport units, not vh', () => {
    // On iOS Safari the viewport height changes as the URL bar collapses; `vh` leaves the
    // bottom row of controls under the browser chrome.
    expect(layout).toMatch(/h-dvh/);
    expect(layout).not.toMatch(/\bh-screen\b/);
  });

  it('keeps the mini-player out of the scroll flow of the content it sits below', () => {
    // The player is a flow sibling of <main>, not an overlay, so the last list item cannot
    // slide underneath it. That is stronger than padding the scroll container by the player
    // height, which drifts the moment the player's height changes.
    const mainClose = layout.indexOf('</main>');
    const after = layout.slice(mainClose);
    expect(after).toContain('<MiniPlayer />');
    expect(after.indexOf('<MiniPlayer />')).toBeLessThan(after.indexOf('<BottomNavigation />'));
    expect(layout).toMatch(/<main[^>]*min-h-0[^>]*overflow-auto/);
  });

  it('applies the paper grain exactly once', () => {
    expect(layout.match(/paper-grain/g)).toHaveLength(1);
  });
});
