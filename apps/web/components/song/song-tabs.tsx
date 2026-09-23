'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@youandfriends/ui';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { parseSongTab, SONG_TAB_LABELS, SONG_TABS, type SongTab } from '@/lib/songs/tabs';

/**
 * Overview, Lyrics, Files, Comments & activity (`docs/DESIGN.md` §4), with the active tab in the
 * URL (`?tab=lyrics`) so it is linkable and survives a reload.
 *
 * `replace`, not `push`: flicking between tabs is not navigation anyone expects Back to undo one
 * tab at a time, and a history entry per click buries the page they actually came from. The
 * server reads the same parameter for the first paint, so a reload opens on the right tab with
 * no flash of Overview.
 *
 * The selected tab is shown by an underline *and* a weight change (the `TabsTrigger` primitive),
 * never colour alone.
 */
export function SongTabs({
  panels,
}: {
  readonly panels: Readonly<Record<SongTab, React.ReactNode>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = parseSongTab(searchParams.get('tab'));
  // Optimistic: the tab changes on click, before the router has committed the new URL. The
  // pending choice is remembered with the URL it was made against, so once the URL moves on —
  // this navigation landing, or Back — the URL is the answer again.
  const [pending, setPending] = React.useState<{ tab: SongTab; from: SongTab } | null>(null);
  const active = pending !== null && pending.from === fromUrl ? pending.tab : fromUrl;

  function select(value: string) {
    const tab = parseSongTab(value);
    setPending({ tab, from: fromUrl });
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') params.delete('tab');
    else params.set('tab', tab);
    const query = params.toString();
    router.replace(`${pathname}${query === '' ? '' : `?${query}`}` as Route, { scroll: false });
  }

  return (
    <Tabs value={active} onValueChange={select} className="flex min-w-0 flex-col">
      <TabsList aria-label="Song sections" className="w-full overflow-x-auto">
        {SONG_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="min-h-11 shrink-0">
            {SONG_TAB_LABELS[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {SONG_TABS.map((tab) => (
        <TabsContent key={tab} value={tab}>
          {panels[tab]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
