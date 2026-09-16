import { PRODUCT_NAME } from '@youandfriends/config';
import type { Metadata } from 'next';

import { Controls } from './_parts/controls';
import { Overlays } from './_parts/overlays';
import { Structure } from './_parts/structure';
import { TokenSheets } from './_parts/token-sheets';
import { Viewports } from './_parts/viewports';

/**
 * Component showcase — development and preview only.
 *
 * **Why a route rather than Storybook.** The build prompt leaves this open: "Storybook or an
 * isolated showcase if it materially accelerates consistency". A route inside the app shares
 * the real token pipeline, the real fonts, the real Tailwind build, and the real component
 * exports. Storybook would be a second build to keep in sync, and the class of bug it would
 * most likely miss — a token that resolves differently in the app than in the story — is
 * precisely the class this page exists to catch. Recorded here rather than as an ADR because
 * it is reversible in one directory.
 *
 * **Why it cannot reach production.** `docs/THREAT_MODEL.md` treats an unlisted route as a
 * reachable route. This file is named `page.dev.tsx`, and `dev.tsx` is only a page extension
 * outside production (`next.config.ts`), so the route is absent from the production build
 * rather than hidden inside it. `proxy.ts` refuses the path as a second lock.
 *
 * **What it renders.** Only the real exports from `@youandfriends/ui`, never a local copy —
 * a copy drifts, and a drifting showcase is worse than none, because it still looks like
 * evidence.
 *
 * **What it cannot render.** `:hover`, `:focus-visible`, and `:active` are browser states; no
 * amount of static markup produces them, and reproducing their classes by hand would be the
 * local copy this page forbids. Every group carries a `data-testid`, and task `120` drives
 * those states in a real browser.
 */
export const metadata: Metadata = {
  title: `Showcase — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

const SECTIONS = [
  ['tokens', 'Tokens'],
  ['button', 'Button'],
  ['badge', 'Badge'],
  ['input', 'Input'],
  ['toggle', 'Toggles'],
  ['select', 'Select'],
  ['dialog', 'Dialog and sheets'],
  ['menu', 'Menus'],
  ['command', 'Command'],
  ['toast', 'Toast'],
  ['tabs', 'Tabs'],
  ['display', 'Display'],
  ['split-pane', 'Split pane'],
  ['viewports', 'Responsive shell'],
] as const;

export default function ShowcasePage() {
  return (
    <div className="bg-background min-h-dvh px-6 py-8" data-testid="showcase">
      <header className="mb-8">
        <h1 className="text-display text-foreground font-serif">Showcase</h1>
        <p className="text-body text-muted-foreground mt-2 max-w-prose font-sans">
          Every design-system primitive in the states it can be put into declaratively. Hover,
          focus, and active are browser states — the anchors here are driven in a real browser by
          task <code className="font-mono">120</code>.
        </p>
        <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-caption text-olive-text font-sans underline underline-offset-2"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="flex flex-col gap-12">
        <TokenSheets />
        <Controls />
        <Overlays />
        <Structure />
        <Viewports />
      </div>
    </div>
  );
}
