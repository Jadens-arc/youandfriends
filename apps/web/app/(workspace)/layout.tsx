import { CommandEntry } from '@/components/shell/command-entry';
import { NavigationRail } from '@/components/shell/navigation-rail';
import { PlayerRegion } from '@/components/shell/player-region';

/**
 * Workspace shell (docs/DESIGN.md §4).
 *
 * The structure here is load-bearing, not cosmetic. `NavigationRail` and `PlayerRegion` are
 * siblings of `{children}`, so Next.js re-renders only the route segment on navigation and
 * the player element is never unmounted. Moving either into a page would restart audio on
 * every route change.
 *
 * The paper grain is applied once, here, rather than per card — a per-element filter costs
 * paint on every scroll (docs/DESIGN.md §11).
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      <NavigationRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
          <CommandEntry />
        </header>

        {/* The only part that changes on navigation. */}
        <main className="paper-grain min-h-0 flex-1 overflow-auto">{children}</main>

        <PlayerRegion />
      </div>
    </div>
  );
}
