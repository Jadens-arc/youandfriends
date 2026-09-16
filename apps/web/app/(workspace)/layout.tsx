import { CommandEntry } from '@/components/shell/command-entry';
import { BottomNavigation } from '@/components/shell/mobile/bottom-navigation';
import { MobileHeader } from '@/components/shell/mobile/mobile-header';
import { MiniPlayer } from '@/components/shell/mobile/mini-player';
import { NavigationRail } from '@/components/shell/navigation-rail';
import { PlayerRegion } from '@/components/shell/player-region';

/**
 * Workspace shell (docs/DESIGN.md §4 and §10).
 *
 * The structure here is load-bearing, not cosmetic. The navigation and player elements are
 * siblings of the route segment, so Next.js re-renders only that segment on navigation and
 * the player is never unmounted. Moving either into a page would restart audio on every
 * route change.
 *
 * Desktop and mobile chrome are both rendered and switched with CSS rather than by branching
 * on a viewport measurement. Branching in JavaScript would unmount and remount the player
 * region when the breakpoint is crossed — on an orientation change, for instance — which is
 * the same failure the layout is built to prevent.
 *
 * `dvh` rather than `vh`: on iOS Safari the viewport height changes as the URL bar collapses,
 * and `vh` leaves the bottom row of controls under the browser chrome.
 *
 * The paper grain is applied once, here, rather than per card — a per-element filter costs
 * paint on every scroll (docs/DESIGN.md §11).
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      {/* Desktop rail. */}
      <div className="hidden md:flex">
        <NavigationRail />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border hidden h-14 shrink-0 items-center justify-between gap-4 border-b px-4 md:flex">
          <CommandEntry />
        </header>

        {/* Mobile: drill-down header with the back affordance. Hidden on desktop by its own
            class rather than a wrapper, so the header element itself carries the safe-area
            inset for the notch. */}
        <MobileHeader />

        {/* The only part that changes on navigation. */}
        <main className="paper-grain min-h-0 flex-1 overflow-auto">{children}</main>

        {/* Mobile: mini-player above bottom navigation. */}
        <div className="md:hidden">
          <MiniPlayer />
          <BottomNavigation />
        </div>

        {/* Desktop: full-width player bar. */}
        <div className="hidden md:block">
          <PlayerRegion />
        </div>
      </div>
    </div>
  );
}
